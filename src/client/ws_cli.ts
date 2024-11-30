import { createWebSocketStream, WebSocket } from "ws";
import { IApplication, PipeSetup } from "../shared_types";
import { Cancellation } from "../cancellation";
import { exampleListenPort } from "../consts";
import { connectStdIO } from "../wiring";

export class ClientApplication implements IApplication {
  private ws: WebSocket | undefined;
  private url: string | undefined;
  private unpipe?: () => void;

  constructor(
    public readonly endpoint: string,
    private pipelineSetup?: PipeSetup
  ) {}

  start(): Cancellation {
    const ws = new WebSocket(this.endpoint);
    this.ws = ws;
    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
      process.exit(1);
    });

    ws.on("close", () => {
      if (this.unpipe) {
        // In case of closing is initiated by the remote peer.
        console.log("Closing initiated by remote peer.");
        this.unpipe();
        this.unpipe = undefined;
      }

      console.log(`WebSocket closed: ${this.url}`);
      process.exit(0);
    });

    ws.on("open", () => {
      this.url = ws.url;
      console.log(`Connection to ${this.url} is established.`);
      const dup = createWebSocketStream(ws);

      const pipeSetup = this.pipelineSetup ?? connectStdIO;
      const cancelPipe = pipeSetup(dup);
      console.log(`Pipes are set up for peer: ${this.url}`);

      this.unpipe = () => {
        console.log(`Uninstalling pipes...`);
        cancelPipe.dispose();
        this.unpipe = undefined;
      };
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

    this.ws?.close();
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
  main(`ws://localhost:${exampleListenPort}/hello`);
}

/**
 * To manually test if it's functioning properly, first launch a server:
 *
 * node dist/test_ws_srv.js
 *
 * Then invokes the client to test its echo function:
 *
 * dd if=/dev/urandom of=test.bin bs=1m count=10
 * sha256sum ./test.bin > test.bin.sha256sum
 * mv test.bin test.bin.source
 * cat test.bin.source | node dist/test_ws_cli.js | tee test.bin > /dev/null
 * sha256sum -c ./test.bin.sha256sum
 */
