import { AddressInfo, createServer as createTCPServer } from "net";
import { createServer as createH2Server, constants as h2Consts } from "http2";
import { formatAddrInfo } from "./utils";
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

export const transportTCP = "tcp";
export const transportWS = "ws";
export const transportHTTP2 = "h2";

export type TransportLayerProtocol =
  | typeof transportTCP
  | typeof transportWS
  | typeof transportHTTP2;

export class ServerApplication implements IApplication {
  private conns: ConnHandle[];

  constructor(
    public readonly portNum: number,
    public readonly dualTrip: boolean,
    public readonly transport: TransportLayerProtocol
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

    if (this.transport === transportTCP) {
      const srv = createTCPServer((cliSkt) => {
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
    } else if (this.transport === transportWS) {
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
    } else if (this.transport === transportHTTP2) {
      const h2Srv = createH2Server();

      h2Srv.on("request", (req, res) => {
        const stream = req.stream;
        const ses = stream.session;
        const skt = ses?.socket;
        const addr = formatAddrInfo({
          family: skt?.remoteFamily ?? "",
          address: skt?.remoteAddress ?? "",
          port: skt?.remotePort ?? 0,
        });
        const streamId = stream.id;
        const path = req.headers[h2Consts.HTTP2_HEADER_PATH];
        console.log(
          `On request: path=${path}, streamId=${streamId}, addr=${addr}`
        );

        stream.on("close", () => {
          stream.unpipe();
          console.log(`Stream closed: streamId=${streamId}, addr=${addr}`);
        });

        stream.pipe(stream);
      });

      h2Srv.listen(this.portNum, () => {
        const addr = h2Srv.address();
        const addrStr = formatAddrInfo(addr);
        console.log(`HTTP2 server is listening on: ${addrStr}`);
      });
    } else {
      console.error("Unknown transport:", this.transport);
      process.exit(1);
    }

    return cancellation;
  }
}
