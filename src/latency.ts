import { Transform, TransformOptions, TransformCallback } from "stream";
import { MeasurePDU, pktSpec } from "./pdu";

// 默认分配给 SendTxTracker 的每个 slot 8 字节的空间
const defaultSlotSize = 8;

/**
 * 这个类型的实例用于记录每个封包的发送时间，key 是 `seqNum`，value 获取自 `performance.now()`。
 * 使用 seqNum 对 capacity 取模作为 idx 来进行记录。
 */
export function makeTxTracker(capacity: number) {}
export class SendTxTracker {
  private buf: Buffer;
  private readonly slotSize: number;

  constructor(public readonly capacity: number = 2 ** 8 - 1) {
    if (this.capacity <= 0) {
      throw "Invalid capacity";
    }

    this.slotSize = defaultSlotSize;
    this.buf = Buffer.alloc(capacity * this.slotSize);
  }

  getVal(seqNum: bigint | number): bigint {
    return this.buf.readBigUint64BE(
      (Number(seqNum) % this.capacity) * this.slotSize
    );
  }

  setVal(seqNum: bigint | number, val: bigint): void {
    this.buf.writeBigUInt64BE(
      val,
      (Number(seqNum) % this.capacity) * this.slotSize
    );
  }
}

class LatencyAnalyzer {
  public sendTrip: number | undefined;
  public backTrip: number | undefined;
  public roundTrip: number | undefined;

  constructor(public readonly seqNum: BigInt) {}
}

/**
 * 使用精确的时间（例如，performance.now()获取到的时间）来计算往返延迟，
 * 使用毫秒级解析度的 UTC 时间来计算单程延迟。
 */
export class LatencyCalculator extends Transform {
  constructor(private tracker: SendTxTracker, opts: TransformOptions = {}) {
    super({ ...opts, objectMode: true });
  }

  _transform(
    chunk: MeasurePDU,
    encoding: BufferEncoding | undefined,
    callback: TransformCallback
  ) {
    const elapsed = this.tracker.getVal(chunk.seqNum);
    if (elapsed === undefined) {
      console.error(
        `SeqNum=${chunk.seqNum}: Invalid PDU, no elapsed time delta associated in txTracker.`
      );
      callback();
      return;
    }

    const analyzedMeasure = new LatencyAnalyzer(chunk.seqNum);
    analyzedMeasure.roundTrip = Number(elapsed);
    if (chunk.cliTx !== BigInt(0) && chunk.srvTx !== BigInt(0)) {
      analyzedMeasure.sendTrip = Number(chunk.srvTx) - Number(chunk.cliTx);
      analyzedMeasure.backTrip = Date.now() - Number(chunk.srvTx);
    }

    this.push(analyzedMeasure);
    callback();
  }
}

export class PrettyPrintFormatter extends Transform {
  constructor(opts = {}) {
    super({ ...opts, objectMode: true });
  }

  _transform(
    chunk: LatencyAnalyzer,
    encoding: BufferEncoding | undefined,
    callback: TransformCallback
  ) {
    let infos: string[] = [];
    infos.push(
      `SeqNum: ${chunk.seqNum}`,
      `RoundTrip: ${((chunk.roundTrip ?? 0) / 10 ** 6).toFixed(6)}ms`
    );

    if (chunk.sendTrip !== undefined && chunk.backTrip !== undefined) {
      infos.push(
        `SendTrip: ${chunk.sendTrip.toFixed(0)}ms`,
        `BackTrip: ${chunk.backTrip.toFixed(0)}ms`
      );
    }

    callback(null, Buffer.from(infos.join(", ") + "\n", pktSpec.encoding));
  }
}

/**
 * 此 Transform stream 假定一个已经设定了 seqNum 的 PDU (Buffer)，
 * 它从 PDU 读取 seqNum，然后将 seqNum 和当前高精度时间关联。
 */
export class TxLogPass extends Transform {
  private tracker: SendTxTracker;
  constructor(tracker: SendTxTracker, opts: TransformOptions = {}) {
    super({ ...opts, objectMode: true });
    this.tracker = tracker;
  }

  // 确保是一块完整的 Buffer 进来，所以用 object 对它进行包裹。
  _transform(
    chunk: { buffer: Buffer },
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    const seqNum = BigInt(
      chunk.buffer.readBigUint64BE(pktSpec.fields.seqNum.offset)
    );
    this.tracker.setVal(seqNum, process.hrtime.bigint());
    callback(null, chunk.buffer);
  }
}

export type Counter = { count: number };
export function makeCounter() {
  return { count: 0 } as Counter;
}

export class SeqLogPass extends Transform {
  private counter: Counter;
  constructor(counter: Counter, opts: TransformOptions = {}) {
    super({ ...opts, objectMode: true });
    this.counter = counter;
  }

  _transform(
    chunk: MeasurePDU,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    const seqNum = this.counter.count;
    chunk.seqNum = BigInt(seqNum);
    this.counter.count++;
    callback(null, chunk);
  }
}
