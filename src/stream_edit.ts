import { Transform, TransformCallback, TransformOptions } from "stream";
import { KMPDFA } from "./sequence";
import { ringBufWrite } from "./ring_buf_op";

export type StreamEditPlan = {
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

export type StreamEditConfig = {
  accessCode: Buffer;
  plan: StreamEditPlan;
};

export class StreamEdit extends Transform {
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
