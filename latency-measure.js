const { Socket } = require("net");
const { Readable, Transform, Duplex } = require("stream");
const os = require("os");

class TimerStream extends Readable {
  constructor(intervalSecs, opts = {}) {
    super(opts);
    this.intervalSecs = intervalSecs;
    this.timer = null;
  }

  _read() {
    if (!this.timer) {
      this.timer = setInterval(() => {
        if (!this.push(Buffer.from("tick"))) {
          // actual content doesn't matter
          clearInterval(this.timer);
          this.timer = null;
        }
      }, this.intervalSecs * 1000);
    }
  }

  _destroy(err, callback) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    callback(err);
  }
}

class TimestampInjector extends Transform {
  constructor(opts = {}) {
    super(opts);
  }

  _transform(chunk, encoding, callback) {
    // Replace chunk with current timestamp (8 bytes)
    const now = BigInt(Date.now());
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigUInt64BE(now);
    this.push(buf);
    callback();
  }
}

// Refers to PacketDesign.md
const pktSpec = {
  totalSize: 64,
  endianess: "BE",
  encoding: "utf-8",
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

function checkPktSpec() {
  let total = 0;

  const fieldObjects = [];
  for (const fieldKey in pktSpec.fields) {
    const fieldObj = pktSpec.fields[fieldKey];
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

checkPktSpec();

class PacketFormulater extends Transform {
  constructor(opts = {}) {
    super(opts);
    this.seqNum = 0;
  }

  _transform(chunk, encoding, callback) {
    if (!(chunk instanceof Buffer)) {
      throw TypeError("Invalid chunk format, expecting Buffer, got:", chunk);
    }

    if (chunk.length !== 8) {
      throw TypeError("Invalid chunk length, expecting: 8, got:", chunk.length);
    }

    const buf = Buffer.alloc(pktSpec.totalSize, 0);

    // Preamble
    buf.fill(
      pktSpec.magicStr,
      pktSpec.fields.preamble.offset,
      pktSpec.fields.preamble.offset + pktSpec.fields.preamble.length
    );

    // (Reserved)
    buf.fill(
      0,
      pktSpec.fields.reserved.offset,
      pktSpec.fields.reserved.offset + pktSpec.fields.reserved.length
    );

    // Rev
    buf.writeBigUint64BE(BigInt(1), pktSpec.fields.rev.offset);

    // CliTx
    buf.fill(
      chunk,
      pktSpec.fields.cliTx.offset,
      pktSpec.fields.cliTx.offset + pktSpec.fields.cliTx.length
    );

    buf.writeBigUint64BE(BigInt(0), pktSpec.fields.srvTx.offset);

    buf.writeBigUint64BE(BigInt(this.seqNum++), pktSpec.fields.seqNum.offset);

    this.push(buf);
    callback();
  }
}

class MeasurePDU {
  constructor(chunk) {
    if (!(chunk instanceof Buffer)) {
      throw TypeError("Expecting Buffer, got:", chunk);
    }

    if (chunk.length < pktSpec.totalSize) {
      throw TypeError(
        `Incorrect buffer size, expecting: ${pktSpec.totalSize}, got:`,
        chunk.length
      );
    }

    this.valid =
      chunk.compare(
        pktSpec.magicStr,
        0,
        pktSpec.magicStr.length,
        0,
        pktSpec.magicStr.length
      ) === 0;

    if (!this.valid) {
      return;
    }

    this.preamble = Buffer.from(chunk.subarray(0, pktSpec.magicStr.length));
    this.rev = chunk.readBigUint64BE(pktSpec.fields.rev.offset);
    this.cliTx = chunk.readBigUint64BE(pktSpec.fields.cliTx.offset);
    this.srvTx = chunk.readBigUInt64BE(pktSpec.fields.srvTx.offset);
    this.seqNum = chunk.readBigUint64BE(pktSpec.fields.seqNum.offset);
  }

  toString() {
    return `MeasurePDU { rev: ${this.rev}, cliTx: ${this.cliTx}, srvTx: ${this.srvTx}, seqNum: ${this.seqNum} }`;
  }
}

/**
 * Check if given pattern `pattern` is exsisting at buffer `buf`.
 * if it is, returns the offset (in bytes), otherwise returns `-1`.
 * @param {Buffer} buf
 * @param {Buffer} pattern
 * @returns {number}
 */
function checkPattern(buf, pattern) {
  if (!(buf instanceof Buffer && pattern instanceof Buffer)) {
    throw TypeError("Expecting Buffer.");
  }

  if (buf.length < pattern.length) {
    return -1;
  }

  if (pattern.length <= 0) {
    throw "Invalid pattern length, this is undefined behavior.";
  }

  // Now it's comfortable to check pattern, since buf.length >= pattern.length > 0.
  // (todo): Rewrites this using KMP algorithm.
  for (let i = 0; i < buf.length - pattern.length + 1; ++i) {
    if (buf.compare(pattern, 0, pattern.length, i, i + pattern.length) === 0) {
      return i;
    }
  }

  return -1;
}

class PacketParser extends Transform {
  constructor(opts = {}) {
    super({ ...opts, objectMode: true });

    this.tempBufSize = 0;
    this.tempBuf = Buffer.alloc(pktSpec.totalSize, 0);
    this.hasPreamble = false;

    if (this.tempBuf.length < pktSpec.totalSize) {
      throw "Size of temporary buffer shall not be less than the total size of PDU.";
    }
  }

  _transform(chunk, encoding, callback) {
    if (!(chunk instanceof Buffer)) {
      throw TypeError("Invalid chunk format, expecting Buffer, got:", chunk);
    }

    // 当前 buffer 余下这么多空间可用
    const remainSpace = this.tempBuf.length - this.tempBufSize;

    // 我要从 chunk 拿多长的数据
    const sizeTaken = Math.min(remainSpace, chunk.length);

    // 要反压给上游什么样的数据
    const buffersReturn = [];
    if (chunk.length > remainSpace) {
      const retBuf = chunk.subarray(remainSpace);
      buffersReturn.push(retBuf);
    }

    // 把 chunk 写到 buffer 末尾，取 sizeTaken 这么多
    this.tempBuf.fill(chunk, this.tempBufSize, this.tempBufSize + sizeTaken);

    // 追加内容到 buffer 末尾之后，更新 buffer 实时大小
    this.tempBufSize += sizeTaken;

    // 若已有足够多的数据可用于解析 preamble，则将 preamble 及之后的内容平移到 buffer 开头。
    if (this.tempBufSize >= pktSpec.magicStr.length) {
      this.hasPreamble = false;
      const idx = checkPattern(this.tempBuf, pktSpec.magicStr);
      if (idx !== -1) {
        // buffer 里面有 preamble 存在，preamble 只是用来确定封包的起始位置，
        // 并不代表封包是完好无损的，也不代表以收集到了足够用于解析整个封包的数据。
        // 检测到了 preamble 之后，就把 preamble 之前的全部丢掉。
        this.tempBuf.copyWithin(0, idx, this.tempBuf.length);
        this.tempBufSize -= idx;
        this.hasPreamble = true;
      }

      // 若有 preamble，并且 buffer 当前长度足够解析一个 packet，尝试解析
      // 无论解析成功，失败与否，都：
      // 1. 丢弃用过了封包内容，一个封包损坏了就是损坏了。
      // 2. 清除 hasPreamble 标志。
      if (this.tempBufSize >= pktSpec.totalSize && this.hasPreamble) {
        this.hasPreamble = false;

        // 获取 packet 自身的内容
        const pktBuf = Buffer.alloc(pktSpec.totalSize);
        this.tempBuf.copy(pktBuf, 0, 0, pktSpec.totalSize);

        // 更新当前 buffer 及其实时容量记录。
        this.tempBuf.copyWithin(0, pktBuf.length, this.tempBuf.length);
        this.tempBufSize -= pktBuf.length;

        const pduObj = new MeasurePDU(pktBuf);
        if (pduObj.valid) {
          this.push(pduObj);
        } else {
          console.error(
            "Warning, malformed packet (shouldn't happen):",
            pktBuf
          );
        }
      }
    }

    if (buffersReturn.length > 0) {
      const retBuf = Buffer.concat(buffersReturn);
      if (retBuf.length > 0) {
        console.debug("[debug] returning buffer:", retBuf);
        this.unshift(retBuf);
      }
    }

    callback();
  }

  _flush(callback) {
    if (this.tempBufSize === pktSpec.totalSize) {
      const pdu = new MeasurePDU(this.tempBuf);
      if (pdu.valid) {
        this.push(pdu);
      }
    }

    callback();
  }
}

class LatencyCalculator extends Transform {
  constructor(opts = {}) {
    super({ ...opts, objectMode: true });
  }

  _transform(chunk, encoding, callback) {
    if (!(chunk instanceof MeasurePDU)) {
      throw TypeError("Expects a MeasurePDU object");
    }

    // Read received timestamp and calculate latency
    const receivedTime = chunk.cliTx;
    const now = BigInt(Date.now());
    const latency = now - receivedTime;

    // Output absolute latency value as 8 bytes
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigUInt64BE(latency >= 0n ? latency : -latency);
    this.push(buf);
    callback();
  }
}

class NumberFormatter extends Transform {
  constructor(opts = {}) {
    super(opts);
  }

  _transform(chunk, encoding, callback) {
    if (chunk.length !== 8) {
      callback(new Error("Invalid number chunk size"));
      return;
    }

    // Convert uint64 to readable string with ms unit
    const value = chunk.readBigUInt64BE();
    this.push(`${value}ms\n`);
    callback();
  }
}

class LatencyMeasurer {
  constructor(intervalSecs, rwStream) {
    if (!(rwStream instanceof Duplex)) {
      throw TypeError("rwStream shall be a Duplex(Readable and Writable)");
    }

    this.rwStream = rwStream;

    // Create streams
    this.timerStream = new TimerStream(intervalSecs);
    this.timestampInjector = new TimestampInjector();
    this.packetFomatter = new PacketFormulater();
    this.packetParser = new PacketParser();
    this.latencyCalculator = new LatencyCalculator();
    this.formatter = new NumberFormatter();
  }

  start() {
    this.timerStream
      .pipe(this.timestampInjector)
      .pipe(this.packetFomatter)
      .pipe(this.rwStream)
      .pipe(this.packetParser)
      .pipe(this.latencyCalculator)
      .pipe(this.formatter)
      .pipe(process.stdout)
      .on("error", this._handleError);
  }

  _handleError(err) {
    console.error(err);
    process.exit(1);
  }

  stop() {
    this.timerStream.destroy();
  }
}

// Command line argument handling
if (process.argv.length !== 5) {
  console.error("Usage: node script.js <host> <port> <interval_seconds>");
  process.exit(1);
}

const [host, port, intervalSecs] = process.argv.slice(2);
const portNum = parseInt(port, 10);
const interval = parseInt(intervalSecs, 10);

if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
  console.error("Port must be a number between 1 and 65535");
  process.exit(1);
}

if (isNaN(interval) || interval <= 0) {
  console.error("Interval must be a positive number");
  process.exit(1);
}

switch (os.endianness()) {
  case "LE":
    console.debug("CPU is little endian format");
    break;

  case "BE":
    console.debug("CPU is big endian format");
    break;

  default:
    colsole.debug("Unknown endianness");
}

const socket = new Socket();

socket.connect({ host, port }, () => {
  console.debug(`Connected to ${host}:${port}`);

  const measurer = new LatencyMeasurer(interval, socket);
  measurer.start();
});

socket.on("error", () => {
  console.error("Broken pipe, exitting...");
  process.exit(1);
});

// Handle cleanup on exit
process.on("SIGINT", () => {
  measurer.stop();
  process.exit(0);
});
