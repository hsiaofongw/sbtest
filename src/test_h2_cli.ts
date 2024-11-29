import {
  ClientHttp2Session,
  ClientHttp2Stream,
  connect,
  constants,
} from "http2";
import { exampleListenPort } from "./test_h2_srv";
import { pipeline } from "stream/promises";
import { formatAddrInfo } from "./utils";
import { IApplication } from "./shared_types";
import { Cancellation } from "./cancellation";

class ClientApplication implements IApplication {
  private cliSession: ClientHttp2Session | undefined;
  private cliStream: ClientHttp2Stream | undefined;
  private peerAddr: string = "";
  constructor(public readonly endpointUri: string) {}

  start(): Cancellation {
    const cliSession = connect(this.endpointUri);
    this.cliSession = cliSession;

    cliSession.on("error", (err: any) => {
      console.error("Client Session error:", err);
      process.exit(1);
    });

    cliSession.on("connect", (ses) => {
      this.peerAddr = formatAddrInfo({
        family: ses.socket.remoteFamily ?? "",
        address: ses.socket.remoteAddress ?? "",
        port: ses.socket.remotePort ?? 0,
      });
      console.log("Session is connected, peer is:", this.peerAddr);

      const stream = cliSession.request(
        { [constants.HTTP2_HEADER_PATH]: "/" },
        { endStream: false, waitForTrailers: false }
      );
      this.cliStream = stream;

      process.stdin.pipe(stream);
      stream.pipe(process.stdout);
    });

    cliSession.on("goaway", () => {
      console.log(`Session ${this.peerAddr} received GOAWAY, peer is closing.`);
      // The Http2Session instance will be shut down automatically when the 'goaway' event is emitted.
    });

    return {
      dispose: () => {
        this.shouldDestroy();
      },
    };
  }

  private shouldDestroy() {
    process.stdin.unpipe();
    this.cliStream?.unpipe();
    console.log("All local streams are un-piped now.");

    const cliSession = this.cliSession;
    const peerAddr = this.peerAddr;
    if (cliSession) {
      cliSession.on("close", () => {
        console.log(`Session ${peerAddr} is destroyed.`);
        process.exit(0);
      });

      cliSession.close(); // Preventing new streams from created.
    }

    const stream = this.cliStream;
    if (stream) {
      stream.close(undefined, () => {
        console.log(`Stream ${stream.id} is closed.`);
      });
    }
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
