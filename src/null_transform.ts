import { Transform, TransformCallback, TransformOptions } from "stream";

export class IdentityTransform extends Transform {
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
