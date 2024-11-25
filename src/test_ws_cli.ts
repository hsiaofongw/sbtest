import { pipeline } from "stream/promises";
import WebSocket, { createWebSocketStream } from "ws";
import { exampleListenPort } from "./test_ws_srv";

function main() {
  const ws = new WebSocket(`ws://localhost:${exampleListenPort}/hello`);

  const duplex = createWebSocketStream(ws);

  pipeline(process.stdin, duplex, process.stdout)
    .then(() => {
      console.log("Bye!");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Pipeline error:", err);
      process.exit(1);
    })
    .finally(() => {
      console.log("Exttting...");
      process.exit(0);
    });
}

if (require.main === module) {
  main();
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
