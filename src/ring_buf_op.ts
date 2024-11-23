/**
 * 从 ringbuffer 读取一段数据，调用者需要自己负责更新 ringbuffer 的 head 和 size
 * @param buf ringbuffer 的存储区域
 * @param offset ringbuffer 当前的 head
 * @param nreads 要读取的长度
 * @returns 含实际读取的长度的 buffer
 */
export function ringBufRead(buf: Buffer, offset: number, nreads: number) {
  const actualReads = Math.min(Math.max(0, nreads), buf.byteLength);
  if (actualReads === 0) {
    return Buffer.alloc(0);
  }

  const retBuf = Buffer.alloc(actualReads);
  let didReads = 0;
  while (didReads < actualReads) {
    const startOffset = (offset + didReads) % buf.byteLength;
    const wouldCopy = Math.min(
      buf.byteLength - startOffset,
      actualReads - didReads
    );
    const nbytes = buf.copy(
      retBuf,
      didReads,
      startOffset,
      startOffset + wouldCopy
    );
    didReads += nbytes;
  }

  return retBuf;
}

/**
 * 对 ringBuffer 进行写入操作，实际使用中，调用者仍需字节更新被写入 ringBuffer 的 size。
 * @param dst 目的 ringBuffer 存储区域
 * @param src 源 Buffer 存储区域（不能是一个 ringBuffer）
 * @param dstHead 目的 ringBuffer 当前的 head
 * @param srcOffset 源 Buffer 开始拷贝的 offset（也就是说要跳过多少 bytes 才开始拷贝）
 * @param srcNReads 要拷贝多少字节
 * @returns 实际拷贝的字节数
 */
export function ringBufWrite(
  dst: Buffer,
  src: Buffer,
  dstOffset: number,
  srcOffset: number,
  srcNReads: number
): number {
  if (srcNReads <= 0) {
    return 0;
  }

  let accum = 0;
  while (srcNReads > 0) {
    const maxCopy = Math.min(
      dst.byteLength - dstOffset,
      src.byteLength - srcOffset,
      srcNReads
    );
    const didCopieds = src.copy(
      dst,
      dstOffset,
      srcOffset,
      Math.min(srcOffset + maxCopy, src.byteLength)
    );
    dstOffset = (dstOffset + didCopieds) % dst.byteLength;
    srcOffset = (srcOffset + didCopieds) % src.byteLength;
    srcNReads -= didCopieds;
    accum += didCopieds;
  }

  return accum;
}
