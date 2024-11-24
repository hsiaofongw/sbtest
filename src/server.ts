import { createServer, Server, Socket } from "net";
import { formatAddrInfo, formatFullAddr } from "./utils";
import { Duplex, Transform, TransformCallback, TransformOptions } from "stream";
import { pipeline } from "stream/promises";
import { KMPDFA } from "./sequence";
import { pktSpec } from "./pdu";
import { ringBufWrite } from "./ring_buf_op";

class IdentityTransform extends Transform {
  constructor(opts: TransformOptions = {}) {
    super(opts);
  }

  _transform(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    callback(null, chunk);
  }
}

type StreamEditPlan = {
  offset: number;

  /**
   * 描述到达流的指定位置后如何修改内容。
   *
   * buf 的内容是 accessCode 结束后 offset + 1 个 bytes 这么长的内容。
   * 比如说 accessCode 是 [0x01, 0x02, 0x03, 0x04]，
   * stream 中的一段内容是 [0x4b, 0x5a, 0x01, 0x02, 0x03, 0x04, 0xa3, 0xa4, 0x16, 0x18]
   * 假设 offset 是 2，那么 buf 就会是 [0xa3, 0xa4, 0x16] 这些内容。
   *
   * 用户应当直接原地修改，否则修改不会生效。
   * @param buf accessCode 结束后 offset + 1 个 bytes 这么长的内容。
   */
  action: (buf: Buffer) => void;
};

type StreamEditConfig = {
  accessCode: Buffer;
  plan: StreamEditPlan;
};

class StreamEdit extends Transform {
  private kmpDFA: KMPDFA;
  private hadPreamble: boolean;

  private buf: Buffer;
  private head: number;
  private bufSize: number;

  constructor(
    public readonly config: StreamEditConfig,
    opts: TransformOptions = {}
  ) {
    super(opts);
    this.kmpDFA = new KMPDFA(config.accessCode);
    this.hadPreamble = false;
    this.buf = Buffer.alloc(config.plan.offset + 1);
    this.head = 0;
    this.bufSize = 0;
  }

  private absorbChunkToBuffer(chunk: Buffer, chunkOffset: number) {
    const remainSpace = this.buf.length - this.bufSize;
    const wouldTake = Math.min(remainSpace, chunk.length - chunkOffset);

    if (wouldTake > 0) {
      const didCopied = ringBufWrite(
        this.buf,
        chunk,
        (this.head + this.bufSize) % this.buf.byteLength,
        chunkOffset,
        wouldTake
      );
      this.bufSize += didCopied;

      return didCopied;
    }
    return 0;
  }

  private consumeRingBuf(len: number): void {
    this.bufSize -= len;
    this.head = (this.head + len) % this.buf.length;
  }

  _transform(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    let sizeTaken = 0;
    while (sizeTaken < chunk.byteLength || this.bufSize > 0) {
      sizeTaken += this.absorbChunkToBuffer(chunk, sizeTaken);
      if (this.hadPreamble) {
        const sduLen = this.config.plan.offset + 1;
        if (this.bufSize >= sduLen) {
          const sduBuf = Buffer.alloc(sduLen);
          if (
            ringBufWrite(sduBuf, this.buf, 0, this.head, sduLen) !== sduLen ||
            sduBuf.byteLength !== sduLen
          ) {
            throw Error(
              "Unknown error at StreamEdit pass, call dev to fix it."
            );
          }

          this.config.plan.action(sduBuf);
          this.hadPreamble = false;
          this.push(sduBuf);
          this.consumeRingBuf(sduLen);
        }
        continue;
      }

      const readBytes = this.kmpDFA.write(this.buf, this.head, this.bufSize);
      const passthroughBuf = Buffer.alloc(readBytes);
      if (
        ringBufWrite(passthroughBuf, this.buf, 0, this.head, readBytes) !==
        readBytes
      ) {
        throw Error("Unknown error at StreamEdit pass, call dev to fix it.");
      }
      this.push(passthroughBuf);
      this.consumeRingBuf(readBytes);
      if (this.kmpDFA.isAccepted()) {
        this.hadPreamble = true;
        this.kmpDFA.reset();
      }
    }
    callback();
  }
}

type ConnHandle = {
  key: string;
  socket?: Socket;
  remoteFamily: string;
  remoteHost: string;
  remotePort: string;
  peer: string;
};

export class ConnectionManager {
  private srv: Server;
  private conns: ConnHandle[];

  constructor(
    public readonly portNum: number,
    public readonly dualTrip: boolean
  ) {
    if (dualTrip) {
      console.log("Dual trip timestamping enabled.");
    }
    this.conns = [];
    this.srv = createServer((cliSkt) => {
      this.onConnected(cliSkt);
    });
    this.srv.on("listening", () => {
      this.onListen(this.srv);
    });
  }

  private onListen(srvSkt: Server) {
    const sktAddr = srvSkt.address();
    const sktAddrStr = formatAddrInfo(sktAddr);

    console.log(`Server is listening on: ${sktAddrStr}`);
  }

  private onConnected(cliSkt: Socket) {
    const remoteAddr = formatFullAddr(
      cliSkt?.remoteFamily,
      cliSkt?.remoteAddress,
      cliSkt?.remotePort
    );

    const handle: ConnHandle = {
      remoteFamily: cliSkt?.remoteFamily ?? "",
      remoteHost: cliSkt?.remoteAddress ?? "",
      remotePort: cliSkt?.remotePort?.toString() ?? "",
      peer: remoteAddr,
      socket: cliSkt,
      key: remoteAddr,
    };

    this.conns.push(handle);
    console.log(
      `New connection: ${remoteAddr}, currently ${this.conns.length} connections.`
    );

    if (this.dualTrip) {
      const streamEdit = new StreamEdit({
        accessCode: pktSpec.magicStr,
        plan: {
          offset: pktSpec.totalSize - pktSpec.magicStr.byteLength - 1,
          action(buf) {
            buf.writeBigUInt64BE(
              BigInt(Date.now()),
              pktSpec.fields.srvTx.offset - pktSpec.magicStr.byteLength
            );
          },
        },
      });
      pipeline(cliSkt, streamEdit, cliSkt).catch((err) => {
        console.error("Error on pipelining:", err);
      });
    } else {
      const idTransform = new IdentityTransform();
      pipeline(cliSkt, idTransform, cliSkt).catch((err) => {
        console.error("Error on pipelining:", err);
      });
    }

    cliSkt.on("end", () => {
      this.onDisconnected(remoteAddr);
    });
  }

  private onDisconnected(peer: string) {
    this.conns = this.conns.filter((conn) => conn.key !== peer);
    console.log(
      `Handle for ${peer} removed, currently ${this.conns.length} connections.`
    );
  }

  start() {
    this.srv.listen(this.portNum);
  }
}
