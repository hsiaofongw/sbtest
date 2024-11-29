import { constants, createServer } from "http2";
import { formatAddrInfo } from "./utils";

export const exampleListenPort = 42591;

function main(port: number) {
  const h2Srv = createServer();

  h2Srv.on("request", (req, res) => {
    const stream = req.stream;
    const ses = stream.session;
    const skt = ses?.socket;
    const addr = formatAddrInfo({
      family: skt?.remoteFamily ?? "",
      address: skt?.remoteAddress ?? "",
      port: skt?.remotePort ?? 0,
    });
    const streamId = stream.id;
    const path = req.headers[constants.HTTP2_HEADER_PATH];
    console.log(`On request: path=${path}, streamId=${streamId}, addr=${addr}`);

    stream.on("close", () => {
      console.log(`Stream closed: streamId=${streamId}, addr=${addr}`);
    });

    stream.on("data", (chunk) => {
      const len = chunk.length;
      console.log(
        `Got ${len} bytes chunk from ${addr} stream ${stream.id}, echoing it back.`
      );
      stream.write(chunk, undefined, (err) => {
        if (err) {
          console.error(`Error on write to stream ${addr}:`, err);
        } else {
          console.log(
            `Echo is sent to remote peer: ${addr} stream ${stream.id}, ${len} bytes.`
          );
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
