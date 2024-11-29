import { createWebSocketStream, WebSocketServer, WebSocket } from "ws";
import { IApplication } from "./shared_types";
import { Cancellation } from "./cancellation";
import { formatAddrInfo } from "./utils";
import { Duplex } from "stream";

export const exampleListenPort = 12711;

class ServerApplication implements IApplication {
  private conns: Record<string, { dup?: Duplex; ws: WebSocket }> = {};
  private wss: WebSocketServer | undefined;

  constructor(public readonly listenPort: number) {
    this.conns = {};
  }

  start(): Cancellation {
    const wss = new WebSocketServer({ port: this.listenPort });
    wss.on("error", (err) => {
      console.error("WebSocketServer error:", err);
      process.exit(1);
    });
    this.wss = wss;

    wss.on("listening", () => {
      console.log(`Listening on: ${formatAddrInfo(wss.address())}`);
    });

    wss.on("connection", (wsSkt, req) => {
      const skt = req.socket;
      const addr = formatAddrInfo({
        address: skt.remoteAddress ?? "",
        family: skt.remoteFamily ?? "",
        port: skt.remotePort ?? 0,
      });
      console.log(`New connection: ${addr}`);
      this.conns[addr] = { ws: wsSkt };

      wsSkt.on("close", () => {
        console.log(`Connection closed: ${addr}`);
        delete this.conns[addr];
      });

      wsSkt.on("error", () => {
        console.error("Error on connection:", addr);
        delete this.conns[addr];
      });

      const stream = createWebSocketStream(wsSkt);
      this.conns[addr].dup = stream;

      stream.pipe(stream);
    });

    return {
      dispose: () => {
        this.shouldDestroy();
      },
    };
  }

  private shouldDestroy() {
    const srv = this.wss;
    if (srv) {
      console.log("Closing server...");
      srv.close((err) => {
        if (err) {
          console.error("Error on closing server:", err);
          process.exit(1);
        }
        console.log("Server is closed.");
        process.exit(0);
      });
    }

    for (const key in this.conns) {
      const { ws: wsSkt, dup } = this.conns[key];
      console.log(`Closing connection: ${key}`);
      if (dup) {
        dup.unpipe();
      }

      wsSkt.close();
    }
  }
}

function main(listenPort: number) {
  const app = new ServerApplication(listenPort);
  const cancellation = app.start();
  process.on("SIGINT", () => {
    console.log("Caught SIGINT signal, disposing app...");
    cancellation.dispose();
  });
}

if (require.main === module) {
  main(exampleListenPort);
}
