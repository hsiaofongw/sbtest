import { createWebSocketStream, WebSocket } from "ws";
import { exampleListenPort } from "./test_ws_srv";
import { IApplication } from "./shared_types";
import { Cancellation } from "./cancellation";
import { Duplex } from "stream";

class ClientApplication implements IApplication {
  private ws: WebSocket | undefined;
  private dup: Duplex | undefined;
  private url: string | undefined;

  constructor(public readonly endpoint: string) {}

  start(): Cancellation {
    const ws = new WebSocket(this.endpoint);
    this.ws = ws;
    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
      process.exit(1);
    });

    ws.on("close", () => {
      if (this.dup) {
        // In case of closing is initiated by the remote peer.
        console.log("Closing initiated by remote peer.");
        process.stdin.unpipe(this.dup);
        this.dup.unpipe();
        this.dup = undefined;
      }

      this.ws = undefined;
      console.log(`WebSocket closed: ${this.url}`);
      process.exit(0);
    });

    ws.on("open", () => {
      this.url = ws.url;
      console.log(`Connection to ${this.url} is established.`);
      const dup = createWebSocketStream(ws);
      this.dup = dup;

      process.stdin.pipe(dup);
      dup.pipe(process.stdout);
    });

    return {
      dispose: () => {
        this.shouldDestroy();
      },
    };
  }

  private shouldDestroy() {
    if (this.dup) {
      process.stdin.unpipe();
      this.dup.unpipe();
      this.dup = undefined;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
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
