import {
  Http2Server,
  Http2Session,
  Http2Stream,
  constants,
  createServer,
} from "http2";
import { formatAddrInfo } from "./utils";
import { IApplication } from "./shared_types";
import { Cancellation } from "./cancellation";

export const exampleListenPort = 42591;

class ServerApplication implements IApplication {
  private sessions: Record<
    string,
    { session: Http2Session; streams: Record<string, Http2Stream> }
  > = {};
  private h2Srv: Http2Server;

  constructor(public readonly listenPort: number) {
    this.h2Srv = createServer();
  }

  start(): Cancellation {
    this.h2Srv.on("request", (req, res) => {
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
      console.log(
        `On request: path=${path}, streamId=${streamId}, addr=${addr}`
      );

      if (this.sessions[addr]) {
        if (streamId) {
          if (!this.sessions[addr].streams[streamId]) {
            this.sessions[addr].streams[streamId] = stream;
          }
        }
      } else {
        if (ses) {
          this.sessions[addr] = { session: ses, streams: {} };
          if (streamId) {
            this.sessions[addr]!.streams![streamId] = stream;
          }
        }
      }

      stream.on("close", () => {
        try {
          stream.unpipe();
        } catch (_) {}
        console.log(`Stream closed: streamId=${streamId}, addr=${addr}`);
        if (streamId && this.sessions[addr]?.streams?.[streamId]) {
          delete this.sessions[addr].streams[streamId];
        }
      });

      ses?.on("close", () => {
        if (this.sessions[addr]) {
          delete this.sessions[addr];
        }
      });

      stream.pipe(stream);
    });

    this.h2Srv.listen(this.listenPort, () => {
      console.log(
        `HTTP2 server is listening on: ${formatAddrInfo(this.h2Srv.address())}`
      );
    });

    return {
      dispose: () => {
        this.shouldDestroy();
      },
    };
  }

  private shouldDestroy() {
    // 首先，阻止创建新 session。
    const srvAddr = formatAddrInfo(this.h2Srv.address());
    this.h2Srv.close((err) => {
      if (err) {
        console.error("Error while closing the server:", err);
        process.exit(1);
      }

      console.log(`Actively closed Server ${srvAddr}.`);
      process.exit(0);
    });

    // 然后，针对每个 session，阻止创建新 stream。
    for (const sessionKey in this.sessions) {
      const ses = this.sessions[sessionKey].session;
      try {
        ses.close();
      } catch (_) {}

      // 然后，close 掉每个 session
      const streams = this.sessions[sessionKey].streams;
      for (const streamKey in streams) {
        try {
          streams[streamKey].close(undefined, () => {
            console.log(
              `Actively closed Stream ${streamKey} of Session ${sessionKey}.`
            );
          });
        } catch (_) {}
      }
    }
  }
}

function main(port: number) {
  const app = new ServerApplication(port);
  const cancellation = app.start();
  process.on("SIGINT", () => {
    console.log("Caught SIGINT signal, disposing app...");
    cancellation.dispose();
  });
}

if (require.main === module) {
  main(exampleListenPort);
}
