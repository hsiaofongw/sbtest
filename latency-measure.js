const { Socket } = require("net");
const { Readable, Transform } = require("stream");

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

class LatencyCalculator extends Transform {
  constructor(opts = {}) {
    super(opts);
  }

  _transform(chunk, encoding, callback) {
    if (chunk.length !== 8) {
      callback(new Error("Invalid timestamp chunk size"));
      return;
    }

    // Read received timestamp and calculate latency
    const receivedTime = chunk.readBigUInt64BE();
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
    // Create streams
    this.timerStream = new TimerStream(intervalSecs);
    this.timestampInjector = new TimestampInjector();
    this.latencyCalculator = new LatencyCalculator();
    this.formatter = new NumberFormatter();
    this.socket = new Socket();

    // Connect and set up pipeline
    this.socket.connect(port, host, () => {
      console.debug(`Connected to ${host}:${port}`);

      // Timer -> TimestampInjector -> Socket
      this.timerStream
        .pipe(this.timestampInjector)
        .pipe(this.socket)
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
