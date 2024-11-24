import { Transform, TransformOptions, TransformCallback } from "stream";
import { TimedPacketBuffer } from "./packet";
import { SendTxTracker } from "./latency";

// Refers to PacketDesign.md
export const pktSpec = {
  totalSize: 64,
  endianess: "BE",
  encoding: "utf8" as BufferEncoding,
  magicStr: Buffer.from("node latency-measure.js"),
  fields: {
    preamble: {
      offset: 0,
      length: 23,
    },
    reserved: {
      offset: 23,
      length: 9,
    },
    rev: {
      offset: 32,
      length: 8,
    },
    cliTx: {
      offset: 40,
      length: 8,
    },
    srvTx: {
      offset: 48,
      length: 8,
    },
    seqNum: {
      offset: 56,
      length: 8,
    },
  },
};

export function checkPktSpec(): void {
  let total = 0;

  const fieldObjects = [];
  for (const fieldKey in pktSpec.fields) {
    const fieldObj = (pktSpec.fields as any)[fieldKey];
    total += fieldObj.length;
    fieldObjects.push(fieldObj);
  }

  if (total !== pktSpec.totalSize) {
    throw "Packet total size mis-match.";
  }

  if (pktSpec.magicStr.length !== pktSpec.fields.preamble.length) {
    throw "MagicWords length mis-match.";
  }

  if (pktSpec.endianess !== "BE") {
    throw "Endianess is not BE, which might cause compatibility issues.";
  }

  fieldObjects.sort((a, b) => a.offset - b.offset);
  for (let i = 0; i < fieldObjects.length - 1; ++i) {
    const o = fieldObjects[i].offset;
    const l = fieldObjects[i].length;
    const no = fieldObjects[i + 1].offset;
    if (o + l !== no) {
      throw `Field offset plus its length are in-consistent to that of the next one.
offset: ${o}, length: ${l}, next offset: ${no}`;
    }
  }
}

export class MeasurePDU {
  public rev: BigInt;
  public cliTx: BigInt;
  public srvTx: BigInt;
  public seqNum: BigInt;

  constructor() {
    this.rev = BigInt(1);
    this.cliTx = BigInt(0);
    this.srvTx = BigInt(0);
    this.seqNum = BigInt(0);
  }

  public static fromFixedSizeBuffer(chunk: Buffer): MeasurePDU {
    const pduObj = new MeasurePDU();

    if (!(chunk instanceof Buffer)) {
      throw Error(`Expecting Buffer, got: ${chunk}`);
    }

    const preambleLen = pktSpec.magicStr.byteLength;
    const sduSize = pktSpec.totalSize - preambleLen;
    if (chunk.length < sduSize) {
      throw Error(
        `Incorrect buffer size, expecting: ${sduSize}, got: ${chunk.length}`
      );
    }

    pduObj.rev = chunk.readBigUint64BE(pktSpec.fields.rev.offset - preambleLen);
    pduObj.cliTx = chunk.readBigUint64BE(
      pktSpec.fields.cliTx.offset - preambleLen
    );
    pduObj.srvTx = chunk.readBigUInt64BE(
      pktSpec.fields.srvTx.offset - preambleLen
    );
    pduObj.seqNum = chunk.readBigUint64BE(
      pktSpec.fields.seqNum.offset - preambleLen
    );

    return pduObj;
  }

  public static fromTimestamp(tx: number): MeasurePDU {
    const pduObj = new MeasurePDU();
    pduObj.cliTx = BigInt(tx);
    return pduObj;
  }

  toString(): string {
    return `MeasurePDU { rev: ${this.rev}, cliTx: ${this.cliTx}, srvTx: ${this.srvTx}, seqNum: ${this.seqNum} }`;
  }

  toBuffer(): Buffer {
    const buf = Buffer.alloc(pktSpec.totalSize, 0);

    // Preamble
    buf.fill(
      pktSpec.magicStr,
      pktSpec.fields.preamble.offset,
      pktSpec.fields.preamble.offset + pktSpec.fields.preamble.length
    );

    // Rev
    buf.writeBigUint64BE(BigInt(1), pktSpec.fields.rev.offset);

    // CliTx
    buf.writeBigUint64BE(this.cliTx.valueOf(), pktSpec.fields.cliTx.offset);

    // SeqNum
    buf.writeBigUint64BE(this.seqNum.valueOf(), pktSpec.fields.seqNum.offset);

    return buf;
  }
}

export class PDUFromTx extends Transform {
  constructor(opts: TransformOptions = {}) {
    super({ ...opts, objectMode: true });
  }

  _transform(
    chunk: number,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    callback(null, MeasurePDU.fromTimestamp(chunk));
  }
}

export class PDUFromTimedBuffer extends Transform {
  constructor(private txTracker: SendTxTracker, opts: TransformOptions = {}) {
    super({ ...opts, objectMode: true });
  }

  _transform(
    chunk: TimedPacketBuffer,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    const pduObj = MeasurePDU.fromFixedSizeBuffer(chunk.buf);
    const seqNum = pduObj.seqNum;
    const receivedAt = chunk.tx;
    const sentAt = this.txTracker.getVal(seqNum);
    if (sentAt === undefined || sentAt === null) {
      console.error(`Unidentified packet, seqNum=${seqNum}`);
      callback();
      return;
    }

    this.txTracker.setVal(seqNum, receivedAt - sentAt);
    callback(null, pduObj);
  }
}

export class PacketFormulater extends Transform {
  constructor(opts: TransformOptions = {}) {
    super({ ...opts, objectMode: true });
  }

  _transform(
    chunk: MeasurePDU,
    encoding: BufferEncoding | undefined,
    callback: TransformCallback
  ) {
    callback(null, { buffer: chunk.toBuffer() });
  }
}
