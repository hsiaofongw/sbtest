import { Cancellation } from "./cancellation";
import {
  LatencyCalculator,
  makeCounter,
  PrettyPrintFormatter,
  SendTxTracker,
  SeqLogPass,
  TxLogPass,
} from "./latency";
import { PacketParser } from "./packet";
import {
  PacketFormulater,
  PDUFromTimedBuffer,
  PDUFromTx,
  pktSpec,
} from "./pdu";
import { PipeSetup } from "./shared_types";
import { StreamEdit } from "./stream_edit";
import { TimerStream } from "./timer";

export const connectStdIO: PipeSetup = (dup) => {
  process.stdin.pipe(dup);
  dup.pipe(process.stdout);
  return {
    dispose: () => {
      process.stdin.unpipe();
      dup.unpipe();
    },
  } as Cancellation;
};

export const connectCliPing: (intervalMs: number) => PipeSetup =
  (intervalMs) => (dup) => {
    const counter = makeCounter();
    const txTracker = new SendTxTracker();

    const timer = new TimerStream(intervalMs);
    const pduFromTx = new PDUFromTx();
    const seqLogPass = new SeqLogPass(counter);
    const packetFomatter = new PacketFormulater();
    const txLogPass = new TxLogPass(txTracker);
    timer
      .pipe(pduFromTx)
      .pipe(seqLogPass)
      .pipe(packetFomatter)
      .pipe(txLogPass)
      .pipe(dup);

    const packetParser = new PacketParser(pktSpec.totalSize, pktSpec.magicStr);
    const pduFromBuffer = new PDUFromTimedBuffer(txTracker);
    const latencyCalc = new LatencyCalculator(txTracker);
    const formatter = new PrettyPrintFormatter();

    dup
      .pipe(packetParser)
      .pipe(pduFromBuffer)
      .pipe(latencyCalc)
      .pipe(formatter)
      .pipe(process.stdout);

    return {
      dispose: () => {
        timer.unpipe();
        dup.unpipe();
      },
    };
  };

export const connectSelf: PipeSetup = (dup) => {
  dup.pipe(dup);
  return {
    dispose: () => {
      dup.unpipe();
    },
  };
};

export const connectTimestampping: PipeSetup = (dup) => {
  const streamEdit = new StreamEdit({
    accessCode: pktSpec.magicStr,
    plan: {
      offset: pktSpec.totalSize - pktSpec.magicStr.byteLength - 1,
      action(buf) {
        buf.writeBigUInt64BE(
          BigInt(Date.now()),
          pktSpec.fields.srvTx.offset - pktSpec.magicStr.byteLength
        );
      },
    },
  });

  dup.pipe(streamEdit);
  streamEdit.pipe(dup);
  return {
    dispose: () => {
      dup.unpipe();
      streamEdit.unpipe();
    },
  };
};
