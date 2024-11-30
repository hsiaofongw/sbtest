import {
  Http2Server,
  Http2Session,
  Http2Stream,
  constants,
  createServer,
} from "http2";
import { formatAddrInfo, formatRemoteAddress } from "../utils";
import { IApplication, PipeSetup } from "../shared_types";
import { Cancellation } from "../cancellation";
import { connectSelf } from "../wiring";
import { exampleListenPort } from "../consts";

export class ServerApplication implements IApplication {
  private sessions: Record<
    string,
    {
      session: Http2Session;
      streams: Record<
        string,
        {
          unpipe: () => void;
          stream: Http2Stream;
        }
      >;
    }
  > = {};
  private h2Srv: Http2Server;

  constructor(
    public readonly listenPort: number,
    private setupPipeline?: PipeSetup
  ) {
    this.h2Srv = createServer();
  }

  private trackStream(
    addr: string,
    streamId: string | number,
    stream: Http2Stream,
    ses: Http2Session
  ) {
    const pipeSetup = this.setupPipeline ?? connectSelf;
    const unsetPipeline = pipeSetup(stream);
    const unpipe = () => {
      console.log(`Uninstalling pipes for session ${addr} stream ${streamId}`);
      unsetPipeline.dispose();
    };

    if (!this.sessions[addr]) {
      this.sessions[addr] = { session: ses, streams: {} };
    }

    this.sessions[addr]!.streams[streamId] = { stream, unpipe };
  }

  start(): Cancellation {
    this.h2Srv.on("request", (req, res) => {
      const stream = req.stream;
      const ses = stream.session;

      const skt = ses?.socket;
      const addr = formatRemoteAddress(skt);

      const streamId = stream.id;
      const path = req.headers[constants.HTTP2_HEADER_PATH];

      if (streamId !== undefined && streamId !== null && ses && stream) {
        this.trackStream(addr, streamId, stream, ses);
        console.log(
          `On request: path=${path}, streamId=${streamId}, addr=${addr}`
        );

        stream.on("close", () => {
          if (this.sessions[addr]?.streams?.[streamId]) {
            this.sessions[addr].streams[streamId].unpipe();
            this.sessions[addr].streams[streamId].unpipe = () => {};
            delete this.sessions[addr].streams[streamId];
          }
          console.log(`Stream ${streamId} is closed, session: ${addr}.`);
        });

        ses.on("close", () => {
          console.log(`Session ${addr} is closed.`);
          delete this.sessions[addr];
        });
      }
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
    // 阻止创建新 session。
    const srvAddr = formatAddrInfo(this.h2Srv.address());
    this.h2Srv.close((err) => {
      if (err) {
        console.error(`Error while closing the server ${srvAddr}:`, err);
        process.exit(1);
      }

      console.log(`Server closed: ${srvAddr}.`);
      process.exit(0);
    });

    // 针对每个 session，阻止创建新 stream。
    for (const sessionKey in this.sessions) {
      this.sessions[sessionKey].session.close();

      // close 掉每个 stream
      const streams = this.sessions[sessionKey].streams;
      for (const streamKey in streams) {
        streams[streamKey].unpipe();
        streams[streamKey].unpipe = () => {};
        streams[streamKey].stream.close();
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
