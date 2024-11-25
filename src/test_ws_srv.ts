import { pipeline } from "stream/promises";
import { createWebSocketStream, WebSocketServer } from "ws";
import { IdentityTransform } from "./null_transform";

export const exampleListenPort = 12711;

function main() {
  const wss = new WebSocketServer({ port: exampleListenPort });
  wss.on("listening", () => {
    console.log(`Listening on port: ${exampleListenPort}`);

    wss.on("connection", (cliSkt, req) => {
      const xForwardedfor = req.headers["x-forwarded-for"];
      console.log("Headers:", req.headers);

      const remoteIp = req.socket?.remoteAddress;
      console.log(`New connection: ${xForwardedfor}(${remoteIp})`);

      const idTransform = new IdentityTransform();

      const duplex = createWebSocketStream(cliSkt);
      pipeline(duplex, idTransform, duplex).catch((err) => {
        console.error("Pipeline error:", err);
      });

      cliSkt.on("close", () => {
        console.log(`${xForwardedfor}(${remoteIp}) is leaving...`);
      });
    });
  });

  wss.on("error", (err) => {
    console.error("Server error:", err);
  });

  wss.on("close", () => {
    console.log("Server closed.");
  });
}

if (require.main === module) {
  main();
}
