import { Transform, TransformOptions, TransformCallback } from "stream";
import { KMPDFA } from "./sequence";
import { ringBufRead, ringBufWrite } from "./ring_buf_op";

export type TimedPacketBuffer = {
  tx: number;
  buf: Buffer;
};

/**
 * PacketParser 的工作方式是识别到字节流中出现的封包开头的 magicWords 之后，
 * 截取余下的（也就是 PDU 扣除 magicWords 之后剩下的）的字节构成一个完整的 PDU（裸字节形式，而非对象形式）发给下游。
 */
export class PacketParser extends Transform {
  private head: number;
  private tempBufSize: number;
  private tempBuf: Buffer;
  private hasPreamble: boolean;
  private kmpDfa: KMPDFA;
  private readonly sduLen: number;

  constructor(
    packetSize: number,
    magicWords: Buffer,
    internalBufSize: number = Math.max(1, packetSize) << 4,
    opts: TransformOptions = {}
  ) {
    super({ ...opts, objectMode: true });

    this.head = 0;
    this.tempBufSize = 0;
    this.tempBuf = Buffer.alloc(internalBufSize);

    this.sduLen = packetSize - magicWords.byteLength;
    if (this.sduLen < 0) {
      throw "Invalid SDU length";
    }

    this.kmpDfa = new KMPDFA(magicWords);
    this.hasPreamble = false;

    if (this.tempBuf.length < Math.max(this.sduLen, magicWords.byteLength)) {
      throw "Temporary buffer size is too slow.";
    }
  }

  private absorbChunkToBuffer(chunk: Buffer, chunkOffset: number) {
    const remainSpace = this.tempBuf.length - this.tempBufSize;
    const wouldTake = Math.min(remainSpace, chunk.length - chunkOffset);

    if (wouldTake > 0) {
      const didCopied = ringBufWrite(
        this.tempBuf,
        chunk,
        (this.head + this.tempBufSize) % this.tempBuf.byteLength,
        chunkOffset,
        wouldTake
      );
      this.tempBufSize += didCopied;

      return didCopied;
    }
    return 0;
  }

  private consumeRingBuf(len: number): void {
    this.tempBufSize -= len;
    this.head = (this.head + len) % this.tempBuf.length;
  }

  private yieldPacket(pktLen: number): void {
    const pktBuf = ringBufRead(this.tempBuf, this.head, pktLen);
    this.consumeRingBuf(pktBuf.byteLength);

    this.push({
      tx: performance.now(),
      buf: pktBuf,
    } as TimedPacketBuffer);
    this.hasPreamble = false;
  }

  _transform(
    chunk: Buffer,
    encoding: BufferEncoding | undefined,
    callback: TransformCallback
  ) {
    let sizeTaken = 0;
    while (sizeTaken < chunk.byteLength) {
      sizeTaken += this.absorbChunkToBuffer(chunk, sizeTaken);
      if (this.hasPreamble) {
        if (this.tempBufSize >= this.sduLen) {
          this.yieldPacket(this.sduLen);
        }
        continue;
      }

      const readBytes = this.kmpDfa.write(
        this.tempBuf,
        this.head,
        this.tempBufSize
      );
      this.consumeRingBuf(readBytes);
      if (this.kmpDfa.isAccepted()) {
        this.hasPreamble = true;
        this.kmpDfa.reset();
      }
    }
    callback();
  }
}
