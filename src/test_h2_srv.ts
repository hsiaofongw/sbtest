import { createServer } from "http2";
import { formatAddrInfo } from "./utils";

export const exampleListenPort = 42591;

function main(port: number) {
  const h2Srv = createServer();

  h2Srv.on("sessionError", (err) => {
    console.error("H2 Session Error:", err);
    process.exit(1);
  });

  h2Srv.on("stream", (dup) => {
    const skt = dup.session?.socket;
    const addr = formatAddrInfo({
      family: skt?.remoteFamily ?? "",
      address: skt?.remoteAddress ?? "",
      port: skt?.remotePort ?? 0,
    });
    console.log("New stream: " + addr);

    dup.on("close", () => {
      console.log("Stream closed: " + addr);
    });

    dup.on("data", (chunk) => {
      const len = chunk.length;
      console.log(`Got ${len} bytes chunk from ${addr}, echoing it back.`);
      dup.write(chunk, undefined, (err) => {
        if (err) {
          console.error(`Error on write to stream ${addr}:`, err);
        } else {
          console.log(`Echo is sent to remote peer: ${addr}, ${len} bytes.`);
        }
      });
    });
  });

  h2Srv.listen(port, () => {
    console.log(`HTTP2 server is listening on port: ${port}`);
  });
}

if (require.main === module) {
  main(exampleListenPort);
}
