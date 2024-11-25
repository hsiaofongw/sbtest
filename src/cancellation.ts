export type Cancellation = { dispose: () => void };

export function makeCancellation(): Cancellation {
  return { dispose: () => {} };
}

export function appendCancellation(
  prev: Cancellation,
  newDispose: () => void
): void {
  const prevCb = prev.dispose;
  prev.dispose = () => {
    prevCb();
    newDispose();
  };
}
