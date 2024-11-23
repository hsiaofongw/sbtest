import { Socket } from "net";
import { Duplex } from "stream";
import {
  defaultArgDefines,
  getArgDescriptionLine,
  modeClient,
  modeServer,
  paramKeyDebug,
  paramKeyHelp,
  paramKeyHost,
  paramKeyInterval,
  paramKeyMode,
  paramKeyPort,
  paramKeyVersion,
  parseArgv,
} from "./argparse";
import packageDescriptor from "../package.json";
import { pipeline } from "stream/promises";

import {
  LatencyCalculator,
  PrettyPrintFormatter,
  SendTxTracker,
  SeqLogPass,
  TxLogPass,
  makeCounter,
} from "./latency";
import {
  pktSpec,
  PDUFromTx,
  PDUFromTimedBuffer,
  PacketFormulater,
  checkPktSpec,
} from "./pdu";
import { PacketParser } from "./packet";
import { TimerStream } from "./timer";

class LatencyMeasurer {
  private rwStream: Duplex;
  private timerStream: TimerStream;
  private pduFromTx: PDUFromTx;
  private seqLogPass: SeqLogPass;
  private packetFomatter: PacketFormulater;
  private txLogPass: TxLogPass;
  private packetParser: PacketParser;
  private pduFromBuffer: PDUFromTimedBuffer;
  private latencyCalculator: LatencyCalculator;
  private formatter: PrettyPrintFormatter;

  constructor(intervalMs: number, rwStream: Duplex) {
    const counter = makeCounter();
    this.rwStream = rwStream;
    const txTracker = new SendTxTracker();

    this.timerStream = new TimerStream(intervalMs);
    this.pduFromTx = new PDUFromTx();
    this.seqLogPass = new SeqLogPass(counter);
    this.packetFomatter = new PacketFormulater();
    this.txLogPass = new TxLogPass(txTracker);
    this.packetParser = new PacketParser(pktSpec.totalSize, pktSpec.magicStr);
    this.pduFromBuffer = new PDUFromTimedBuffer(txTracker);
    this.latencyCalculator = new LatencyCalculator(txTracker);
    this.formatter = new PrettyPrintFormatter();
  }

  public start(): void {
    pipeline(
      this.timerStream, // 生成 tick 信号，timestamp（毫秒级时间戳）
      this.pduFromTx, // 从一个 timestamp 构建封包
      this.seqLogPass, // 填写 seqNum。
      this.packetFomatter, // 把 PDU 格式化成 Buffer（二进制）
      this.txLogPass, // 从 raw Buffer 读取 seqNum，把 seqNum 和时间关联，这一步应当离 TCP socket 最近。
      this.rwStream, // 实际负责数据流收发的 Duplex stream
      this.packetParser, // 封包解析完成后，第一时间记录接收时间（把解析时间记下来，透过 chunk object 传给下游）
      this.pduFromBuffer, // 从一块完整的封包 Buffer 构建封包，根据封包中的 seqNum, 以及 txTracker 以及 chunk object 中的 timestamp 更新 txTracker 中的值。
      this.latencyCalculator, // 从 txTracker 中读取精确往返时长和单程时长，生成一个 AnalyzeResult 传给下游。
      this.formatter, // 格式化 AnalyzeResult 为 utf8 编码的字符串二进制数据 (buffer)，传 buffer 给下游。
      process.stdout,
      {
        end: false,
      }
    ).catch((err) => {
      console.error("Error occured on pipeline:", err);
      process.exit(1);
    });
  }

  public stop() {
    this.timerStream.destroy();
  }
}

function printVersion() {
  console.log(packageDescriptor?.version ?? "Unknown");
}

function printUsage(err?: boolean) {
  const allowedUsages = [
    "node script.js --mode client --host <host> --port <port> [options...]",
    "node script.js --mode server --port <port> [options...]",
    "node script.js --help",
  ];

  let usageTxt =
    "Usage:" +
    "\n\n" +
    allowedUsages.map((x) => `${" ".repeat(4)}${x}`).join("\n") +
    "\n\n" +
    defaultArgDefines
      .map((argDef) => " ".repeat(4) + getArgDescriptionLine(argDef))
      .join("\n");

  if (err) {
    console.error(usageTxt);
  } else {
    console.log(usageTxt);
  }
}

async function main() {
  checkPktSpec();

  const cliParams = await parseArgv(process.argv);

  const printRevParam = cliParams.find(
    (param) => param.key === paramKeyVersion
  );
  if (printRevParam) {
    printVersion();
    process.exit(0);
  }

  const printHelpParam = cliParams.find((param) => param.key === paramKeyHelp);
  if (printHelpParam) {
    printUsage();
    process.exit(0);
  }

  const modeParam = cliParams.find((param) => param.key === paramKeyMode);
  if (!modeParam) {
    printUsage(true);
    process.exit(1);
  }

  const mode = String(modeParam.value);

  const hostParam = cliParams.find((param) => param.key === paramKeyHost);
  if (mode === modeClient && !hostParam) {
    printUsage(true);
    process.exit(1);
  }

  const host: string = String(hostParam?.value ?? "");

  const portParam = cliParams.find((param) => param.key === paramKeyPort);
  const portNum: number = portParam?.value as any;
  if (!portParam || typeof portNum !== "number") {
    printUsage(true);
    process.exit(1);
  }

  if (portNum < 0 || portNum > 2 ** 16) {
    console.error(`Invalid port number: ${portNum}`);
    process.exit(1);
  }

  const intervalMs: number =
    (cliParams.find((p) => p.key === paramKeyInterval)?.value as any) ??
    (defaultArgDefines.find((argDef) => argDef.fullKey === paramKeyInterval)
      ?.defaultValue as any);

  if (intervalMs < 1 || !Number.isFinite(intervalMs)) {
    console.error(`Invalid interval spec: ${intervalMs}`);
    process.exit(1);
  }

  let debugBit = false;
  if (cliParams.find((p) => p.key === paramKeyDebug)) {
    debugBit = true;
  }

  if (debugBit) {
    console.log("Parsed Cli Parameters:", cliParams);
  }

  const now = new Date();
  const launchedAt = `Launched at ${now.toISOString()}`;
  if (mode === modeClient) {
    console.log(
      `${launchedAt}
Mode: ${mode}, Peer: ${host}, Port: ${portNum}, IntervalMs: ${intervalMs}`
    );
  } else if (mode === modeServer) {
    console.log(`${launchedAt}
Mode: ${mode}, Port: ${portNum}`);
  } else {
    console.error("Unknown mode:" + mode);
    process.exit(1);
  }

  const appCtx = {
    onStop: () => {},
  };

  // handles Ctrl-C exit
  process.on("SIGINT", () => {
    console.log("Received SIGINT, gracefully exitting...");
    appCtx.onStop();
    process.exit(0);
  });

  if (mode === modeClient) {
    const socket = new Socket();

    const connUri = `tcp://${host}:${portNum}`;

    socket.on("error", () => {
      console.error(
        `Connection to remote endpoint ${connUri} is closed, exitting...`
      );
      process.exit(1);
    });

    console.log(`Connecting to ${connUri}...`);
    socket.connect({ host, port: portNum }, () => {
      console.debug(`Connected.`);

      const measurer = new LatencyMeasurer(intervalMs, socket);
      appCtx.onStop = () => {
        measurer.stop();
      };
      measurer.start();
    });
  } else if (mode === modeServer) {
    console.error("TODO.");
    process.exit(1);
  } else {
    console.error("Unknown mode:" + mode);
    process.exit(1);
  }

  return;
}

main();
