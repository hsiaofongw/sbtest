import { Server, Socket } from "net";
import { Cancellation } from "../cancellation";
import { IApplication, PipeSetup } from "../shared_types";
import { formatAddrInfo, formatRemoteAddress } from "../utils";
import { connectSelf, connectTimestampping } from "../wiring";

export class ServerApplication implements IApplication {
  private srvAddr: string;
  private conns: Record<string, { socket: Socket; unpipe: () => void }>;
  private server: Server;

  constructor(
    public readonly listenPort: number,
    private setupPipeline?: PipeSetup
  ) {
    this.srvAddr = "";
    this.conns = {};
    const server = new Server();
    this.server = server;
  }

  start(): Cancellation {
    const server = this.server;

    server.on("error", (err) => {
      console.error("Server error:", err);
      process.exit(1);
    });

    server.listen(this.listenPort, () => {
      this.srvAddr = formatAddrInfo(server.address());
      console.log(`Server is listening on: ${this.srvAddr}`);
    });

    server.on("connection", (cliSkt) => {
      const peer = formatRemoteAddress(cliSkt);

      console.log(`Setting up pipes for socket: ${peer}`);
      const pipeSetup = this.setupPipeline ?? connectSelf;
      const unsetPipeline = pipeSetup(cliSkt);

      this.conns[peer] = {
        socket: cliSkt,
        unpipe: () => {
          console.log(`Uninstalling pipes for socket ${peer}`);
          unsetPipeline.dispose();
        },
      };
      console.log(
        `New connection: ${peer}, number of connections: ${
          Object.keys(this.conns).length
        }`
      );

      cliSkt.on("error", (err) => {
        console.error(`Socket ${peer} error:`, err);
      });

      cliSkt.on("close", (hasErr) => {
        if (this.conns[peer]) {
          this.conns[peer].unpipe?.();
          this.conns[peer].unpipe = () => {};
          delete this.conns[peer];
        }
        console.log(
          `Socket ${peer} is closed, has error: ${hasErr}, remaining: ${
            Object.keys(this.conns).length
          }`
        );
      });
    });

    return {
      dispose: () => {
        this.shouldDestroy();
      },
    };
  }

  shouldDestroy() {
    console.log(`Closing established connections of server ${this.srvAddr}...`);
    console.log(`Stop server ${this.srvAddr} from accepting new connections.`);
    this.server.close((err) => {
      console.log(`Server ${this.srvAddr} is closed, has error: ${!!err}`);
      if (err) {
        console.error(`Server ${this.srvAddr} has error:`, err);
      }
      process.exit(err ? 1 : 0);
    });

    for (const peer in this.conns) {
      const conn = this.conns[peer];
      conn.unpipe();
      conn.unpipe = () => {};
      console.log(`Ending socket: ${peer} ...`);
      this.conns[peer].socket.end();
    }
  }
}

function main(port: number, patchStream: boolean) {
  let pipeSetUp = connectSelf;
  if (patchStream) {
    pipeSetUp = connectTimestampping;
  }

  const app = new ServerApplication(port, pipeSetUp);
  const cancellation = app.start();
  process.on("SIGINT", () => {
    console.log("Caught SIGINT signal, disposing app...");
    cancellation.dispose();
  });
}

if (require.main === module) {
  const port = process.argv[2];
  if (!port) {
    console.error("Usage: node script.js <port> [-D]");
    process.exit(1);
  }

  let portNum = NaN;
  try {
    portNum = parseInt(port);
    if (Number.isNaN(portNum) || portNum < 0 || portNum >= 65536) {
      console.error(`Invalid port: ${port}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }

  main(
    portNum,
    process.argv.some((param) => param === "-D")
  );
}
