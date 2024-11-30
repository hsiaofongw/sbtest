import { Server, Socket } from "net";
import { Cancellation } from "./cancellation";
import { IApplication } from "./shared_types";
import { formatAddrInfo, formatRemoteAddress } from "./utils";

class ServerApplication implements IApplication {
  private srvAddr: string;
  private conns: Record<string, { socket: Socket; unpipe: () => void }>;
  private server: Server;

  constructor(public readonly listenPort: number) {
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
      console.log(`New connection: ${peer}`);

      console.log(`Setting up pipes for socket: ${peer}`);
      cliSkt.pipe(cliSkt);

      this.conns[peer] = {
        socket: cliSkt,
        unpipe: () => {
          console.log(`Uninstalling pipes for socket ${peer}`);
          cliSkt.unpipe();
        },
      };

      cliSkt.on("error", (err) => {
        console.error(`Socket ${peer} has an error, it would be close then.`);
        console.error(`Socket ${peer} error:`, err);
        this.conns[peer]?.unpipe?.();
        this.conns[peer].unpipe = () => {};
      });

      cliSkt.on("close", (hasErr) => {
        console.log(`Socket ${peer} is closed, has error: ${hasErr}`);
        if (this.conns[peer]) {
          delete this.conns[peer];
        }
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

function main(port: number) {
  const app = new ServerApplication(port);
  const cancellation = app.start();
  process.on("SIGINT", () => {
    console.log("Caught SIGINT signal, disposing app...");
    cancellation.dispose();
  });
}

if (require.main === module) {
  const port = process.argv[2];
  if (!port) {
    console.error("Usage: node script.js <port>");
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

  main(portNum);
}
