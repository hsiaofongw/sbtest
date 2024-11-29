import { connect, constants } from "http2";
import { exampleListenPort } from "./test_h2_srv";
import { pipeline } from "stream/promises";
import { formatAddrInfo } from "./utils";

function main(endpoint: string) {
  const cliSession = connect(endpoint);

  cliSession.on("error", (err: any) => {
    console.error("Client Session error:", err);
  });

  cliSession.on("connect", (ses) => {
    const peerAddr = formatAddrInfo({
      family: ses.socket.remoteFamily ?? "",
      address: ses.socket.remoteAddress ?? "",
      port: ses.socket.remotePort ?? 0,
    });
    console.log("Session is connected, peer is:", peerAddr);

    const stream = cliSession.request(
      { [constants.HTTP2_HEADER_PATH]: "/" },
      { endStream: false, waitForTrailers: false }
    );

    process.stdin.pipe(stream);
    stream.pipe(process.stdout);

    process.on("SIGINT", () => {
      console.log("Received SIGINT, gracefully shutting down itself.");
      process.stdin.unpipe();
      stream.unpipe();
      console.log("All local streams are un-piped now.");

      cliSession.on("close", () => {
        console.log(`Session ${peerAddr} is destroyed.`);
        process.exit(0);
      });

      cliSession.close(); // Preventing new streams from created.

      stream.close(undefined, () => {
        console.log(`Stream ${stream.id} is closed.`);
      });
    });
  });
}

if (require.main === module) {
  main(`http://localhost:${exampleListenPort}`);
}
