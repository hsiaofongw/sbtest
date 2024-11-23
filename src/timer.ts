import { Readable, ReadableOptions } from "stream";
export class TimerStream extends Readable {
  public readonly intervalMs: number;
  private timer: NodeJS.Timeout | undefined;

  constructor(intervalMs: number, opts: ReadableOptions = {}) {
    super({ ...opts, objectMode: true });
    this.intervalMs = intervalMs;
  }
  _read() {
    if (!this.timer) {
      this.timer = setInterval(() => {
        if (!this.push(Date.now())) {
          clearInterval(this.timer);
          this.timer = undefined;
        }
      }, this.intervalMs);
    }
  }

  _destroy(
    err: Error | null,
    callback: (err?: Error | null | undefined) => void
  ) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    callback(err);
  }
}
