import { createWebSocketStream, WebSocketServer, WebSocket } from "ws";
import { IApplication, PipeSetup } from "../shared_types";
import { Cancellation } from "../cancellation";
import { formatAddrInfo, formatRemoteAddress } from "../utils";
import { connectSelf } from "../wiring";
import { exampleListenPort } from "../consts";

export class ServerApplication implements IApplication {
  private conns: Record<string, { unpipe: () => void; ws: WebSocket }> = {};
  private wss: WebSocketServer | undefined;

  constructor(
    public readonly listenPort: number,
    private setupPipeline?: PipeSetup
  ) {
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
      wsSkt.on("close", () => {
        this.conns[addr].unpipe();
        this.conns[addr].unpipe = () => {};
        delete this.conns[addr];

        console.log(
          `Connection closed: ${addr}, remaining: ${
            Object.keys(this.conns).length
          }`
        );
      });

      wsSkt.on("error", () => {
        console.error("Error on connection:", addr);
      });

      const skt = req.socket;
      const addr = formatRemoteAddress(skt);

      console.log(`Setting up pipes for socket: ${addr}`);
      const pipeSetup = this.setupPipeline ?? connectSelf;

      const stream = createWebSocketStream(wsSkt);
      const unsetPipeline = pipeSetup(stream);

      this.conns[addr] = {
        ws: wsSkt,
        unpipe: () => {
          console.log(`Uninstalling pipes for socket: ${addr}`);
          unsetPipeline.dispose();
        },
      };
      console.log(
        `New connection: ${addr}, number of connections: ${
          Object.keys(this.conns).length
        }`
      );
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
      const { ws: wsSkt, unpipe } = this.conns[key];
      console.log(`Closing connection: ${key}`);
      unpipe();
      this.conns[key].unpipe = () => {};
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
