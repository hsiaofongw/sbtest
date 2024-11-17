const { Socket } = require("net");
const { Readable, Transform } = require("stream");
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

    if (chunk.length !== pktSpec.totalSize) {
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

    this.preamble = Buffer.from(chunk, 0, pktSpec.magicStr.length);
    this.rev = chunk.readBigUint64BE(pktSpec.fields.rev.offset);
    this.cliTx = chunk.readBigUint64BE(pktSpec.fields.cliTx.offset);
    this.srvTx = chunk.readBigUInt64BE(pktSpec.fields.srvTx.offset);
    this.seqNum = chunk.readBigUint64BE(pktSpec.fields.seqNum.offset);
  }

  toString() {
    return `MeasurePDU { rev: ${this.rev}, cliTx: ${this.cliTx}, srvTx: ${this.srvTx}, seqNum: ${this.seqNum} }`;
  }
}

class PacketParser extends Transform {
  constructor(opts = {}) {
    super({ ...opts, objectMode: true });

    this.tempBufSize = 0;
    this.tempBuf = Buffer.alloc(pktSpec.totalSize, 0);
  }

  _transform(chunk, encoding, callback) {
    if (!(chunk instanceof Buffer)) {
      throw TypeError("Invalid chunk format, expecting Buffer, got:", chunk);
    }

    const remainSpace = this.tempBuf.length - this.tempBufSize;
    const buffersReturn = [];
    if (chunk.length > remainSpace) {
      buffersReturn.push(Buffer.from(chunk, remainSpace));
    }
    this.tempBuf.fill(
      chunk,
      this.tempBufSize,
      this.tempBufSize + Math.min(remainSpace, chunk.length)
    );

    this.tempBufSize += chunk.length;

    if (this.tempBufSize === pktSpec.totalSize) {
      const pdu = new MeasurePDU(chunk);
      if (pdu.valid) {
        console.debug(`Got valid PDU: ${pdu}`);
        this.push(pdu);
        this.tempBufSize = 0;
      } else {
        this.tempBufSize -= 1;
        this.tempBuf = Buffer.from(this.tempBuf, 1);
      }

      if (buffersReturn.length > 0) {
        const returnBuf = Buffer.concat(buffersReturn);
        if (returnBuf.length > 0) {
          this.unshift(returnBuf);
        }
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
  constructor(host, port, intervalSecs) {
    // Detect system
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

    // Create streams
    this.timerStream = new TimerStream(intervalSecs);
    this.timestampInjector = new TimestampInjector();
    this.packetFomatter = new PacketFormulater();
    this.socket = new Socket();
    this.packetParser = new PacketParser();
    this.latencyCalculator = new LatencyCalculator();
    this.formatter = new NumberFormatter();

    // Connect and set up pipeline
    this.socket.connect(port, host, () => {
      console.debug(`Connected to ${host}:${port}`);

      // Timer -> TimestampInjector -> Socket
      this.timerStream
        .pipe(this.timestampInjector)
        .pipe(this.packetFomatter)
        .pipe(this.socket)
        .pipe(this.packetParser)
        .pipe(this.latencyCalculator)
        .pipe(this.formatter)
        .pipe(process.stdout)
        .on("error", this.handleError);
    });

    this.socket.on("error", this.handleError);
  }

  handleError(err) {
    console.error("broken pipe");
    process.exit(1);
  }

  stop() {
    this.timerStream.destroy();
    this.socket.destroy();
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

// Start the latency measurer
const measurer = new LatencyMeasurer(host, portNum, interval);

// Handle cleanup on exit
process.on("SIGINT", () => {
  measurer.stop();
  process.exit(0);
});
