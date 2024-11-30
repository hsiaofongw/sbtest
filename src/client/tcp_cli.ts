import { Socket } from "net";
import { Cancellation } from "../cancellation";
import { IApplication, PipeSetup } from "../shared_types";
import { formatRemoteAddress } from "../utils";
import { connectCliPing, connectStdIO } from "../wiring";

export class ClientApplication implements IApplication {
  private skt: Socket;
  private peer: string;
  private unpipe: () => void;

  constructor(
    public readonly host: string,
    public readonly port: number,
    private pipeSetup?: PipeSetup
  ) {
    this.skt = new Socket({ allowHalfOpen: false });
    this.peer = "";
    this.unpipe = () => {};
  }

  start(): Cancellation {
    this.skt.connect(this.port, this.host, () => {
      this.peer = formatRemoteAddress(this.skt);
      console.log(`Connected to peer ${this.peer}`);

      const pipeSetup = this.pipeSetup ?? connectStdIO;
      const cancelPipeSetup = pipeSetup(this.skt);
      console.log(`Pipes are set up for peer: ${this.peer}`);

      this.unpipe = () => {
        console.log("Uninstalling pipes...");
        cancelPipeSetup.dispose();
      };
    });

    this.skt.on("error", (err) => {
      console.error("Socket error:", err);
      process.exit(1);
    });

    this.skt.on("close", (err) => {
      console.log(`Socket ${this.peer} is closed, has error: ${err}`);

      // In case of remote shutdown, or forcibly closed.
      this.unpipe();
      this.unpipe = () => {};

      process.exit(err ? 1 : 0);
    });

    return {
      dispose: () => {
        this.shouldDestroy();
      },
    };
  }

  private shouldDestroy() {
    if (this.skt.readyState === "opening" || this.skt.readyState === "closed") {
      process.exit(0);
    }

    this.unpipe();
    this.unpipe = () => {};
    this.skt.end();
  }
}

function main(host: string, port: number, intervalMs: number, ping: boolean) {
  let pipeSetUp = connectStdIO;
  if (ping) {
    pipeSetUp = connectCliPing(intervalMs);
  }

  const app = new ClientApplication(host, port, pipeSetUp);
  const cancellation = app.start();
  process.on("SIGINT", () => {
    console.log("Caught SIGINT signal, disposing app...");
    cancellation.dispose();
  });
}

if (require.main === module) {
  const host = process.argv[2];
  const port = process.argv[3];
  const intv = process.argv[5];

  if (!(host && port)) {
    console.error(
      "Usage: node script.js <host> <port> [--ping] [<intervalMs>]"
    );
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

  let intervalMs = 1000;
  const ping = process.argv.some((param) => param === "--ping");
  if (ping) {
    try {
      const x = parseInt(intv);
      if (Number.isNaN(x) || x <= 0) {
        console.error(`Invalid interval value: ${x}`);
        process.exit(1);
      }
      intervalMs = x;
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  }

  main(host, portNum, intervalMs, ping);
}
