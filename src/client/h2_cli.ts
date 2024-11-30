import {
  ClientHttp2Session,
  ClientHttp2Stream,
  connect,
  constants,
} from "http2";
import { formatRemoteAddress } from "../utils";
import { IApplication, PipeSetup } from "../shared_types";
import { Cancellation } from "../cancellation";
import { exampleListenPort } from "../consts";
import { connectStdIO } from "../wiring";

export class ClientApplication implements IApplication {
  private cliSession: ClientHttp2Session | undefined;
  private cliStream: ClientHttp2Stream | undefined;
  private peerAddr: string = "";
  private unpipe?: () => void;
  public readonly pathname: string = "";

  constructor(
    public readonly endpointUri: string,
    private pipelineSetup?: PipeSetup
  ) {
    try {
      const uriObj = new URL(endpointUri);
      this.pathname = uriObj.pathname;
    } catch (err) {
      console.error("Failed to parse endpoint URI:", err);
    }

    if (!this.pathname) {
      this.pathname = "/";
    }
  }

  start(): Cancellation {
    const cliSession = connect(this.endpointUri);
    this.cliSession = cliSession;

    cliSession.on("error", (err: any) => {
      console.error("Client Session error:", err);
      process.exit(1);
    });

    cliSession.on("connect", (ses) => {
      this.peerAddr = formatRemoteAddress(ses.socket);
      console.log("Session is connected, peer is:", this.peerAddr);

      const stream = cliSession.request(
        { [constants.HTTP2_HEADER_PATH]: this.pathname },
        { endStream: false, waitForTrailers: false }
      );
      this.cliStream = stream;
      const streamId = stream.id;

      const pipeSetup = this.pipelineSetup ?? connectStdIO;
      const calcelPipeSetup = pipeSetup(stream);
      console.log(
        `Pipes are set up for peer ${this.peerAddr} stream: ${streamId}`
      );

      this.unpipe = () => {
        console.log(
          `Uninstalling pipes for peer: ${this.peerAddr} stream: ${streamId}`
        );
        calcelPipeSetup.dispose();
        this.unpipe = undefined;
      };

      stream.on("close", () => {
        console.log(
          `Stream ${streamId} of session ${this.peerAddr} is closed.`
        );
        if (this.unpipe) {
          // close from remote peer
          this.unpipe();
          this.unpipe = undefined;
          this.cliSession?.close();
        }
      });
    });

    cliSession.on("close", () => {
      console.log(`Session ${this.peerAddr} is closed.`);
      process.exit(0);
    });

    return {
      dispose: () => {
        this.shouldDestroy();
      },
    };
  }

  private shouldDestroy() {
    if (this.unpipe) {
      this.unpipe();
      this.unpipe = undefined;
    }

    this.cliSession?.close();
    this.cliStream?.close();
  }
}

function main(endpoint: string) {
  const app = new ClientApplication(endpoint);
  const cancellation = app.start();

  process.on("SIGINT", () => {
    console.log("Caught SIGINT signal, disposing app...");
    cancellation.dispose();
  });
}

if (require.main === module) {
  main(`http://localhost:${exampleListenPort}`);
}
