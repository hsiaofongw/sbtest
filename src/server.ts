import { AddressInfo, createServer, Server, Socket } from "net";
import { formatAddrInfo, formatFullAddr } from "./utils";
import { pipeline } from "stream/promises";
import { pktSpec } from "./pdu";
import { StreamEdit } from "./stream_edit";
import { IApplication } from "./shared_types";
import {
  appendCancellation,
  Cancellation,
  makeCancellation,
} from "./cancellation";
import { IdentityTransform } from "./null_transform";
import { createWebSocketStream, WebSocketServer } from "ws";
import { Duplex } from "stream";

type ConnHandle = {
  key: string;
  addrInfo: AddressInfo;
  xForwardedFor: string | string[];
};

export class ServerApplication implements IApplication {
  private conns: ConnHandle[];

  constructor(
    public readonly portNum: number,
    public readonly dualTrip: boolean,
    public readonly useWS: boolean
  ) {
    if (dualTrip) {
      console.log("Dual trip timestamp patching enabled.");
    }
    this.conns = [];
  }

  private onConnected(
    cliSkt: Duplex,
    addrInfo: AddressInfo,
    xForwardedFor?: string | string[]
  ) {
    const remoteAddr = formatAddrInfo(addrInfo);

    const handle: ConnHandle = {
      addrInfo,
      key: remoteAddr,
      xForwardedFor: xForwardedFor ?? "",
    };

    this.conns.push(handle);
    console.log(
      `New connection: ${remoteAddr}, currently ${this.conns.length} connections.`
    );

    if (this.dualTrip) {
      const streamEdit = new StreamEdit({
        accessCode: pktSpec.magicStr,
        plan: {
          offset: pktSpec.totalSize - pktSpec.magicStr.byteLength - 1,
          action(buf) {
            buf.writeBigUInt64BE(
              BigInt(Date.now()),
              pktSpec.fields.srvTx.offset - pktSpec.magicStr.byteLength
            );
          },
        },
      });
      pipeline(cliSkt, streamEdit, cliSkt).catch((err) => {
        console.error("Error on pipelining:", err);
      });
    } else {
      const idTransform = new IdentityTransform();
      pipeline(cliSkt, idTransform, cliSkt).catch((err) => {
        console.error("Error on pipelining:", err);
      });
    }

    cliSkt.on("end", () => {
      this.conns = this.conns.filter((conn) => conn.key !== remoteAddr);
      console.log(
        `Handle for ${remoteAddr} removed, currently ${this.conns.length} connections.`
      );
    });
  }

  start(): Cancellation {
    const cancellation = makeCancellation();

    if (this.useWS) {
      const wss = new WebSocketServer({ port: this.portNum });
      wss.on("listening", () => {
        const wsSrvAddr = wss.address();
        const wsSrvAddrStr = formatAddrInfo(wsSrvAddr);
        console.log(`WebSocket server is listening on: ${wsSrvAddrStr}`);

        wss.on("connection", (cliCkt, req) => {
          this.onConnected(
            createWebSocketStream(cliCkt),
            {
              family: req.socket.remoteFamily ?? "",
              address: req.socket.remoteAddress ?? "",
              port: req.socket.remotePort ?? 0,
            },
            req.headers["x-forwarded-for"]
          );
        });
      });
    } else {
      const srv = createServer((cliSkt) => {
        this.onConnected(cliSkt, {
          family: cliSkt.remoteFamily ?? "",
          address: cliSkt.remoteAddress ?? "",
          port: cliSkt.remotePort ?? 0,
        });
      });

      srv.on("listening", () => {
        const sktAddr = srv.address();
        const sktAddrStr = formatAddrInfo(sktAddr);

        console.log(`TCP server is listening on: ${sktAddrStr}`);

        appendCancellation(cancellation, () => {
          console.log("Stopped accepting new TCP connections.");
          srv.close();
        });
      });
      srv.listen(this.portNum);
    }

    return cancellation;
  }
}
