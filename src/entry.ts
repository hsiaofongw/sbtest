import { Socket } from "net";
import {
  defaultArgDefines,
  getArgDescriptionLine,
  modeClient,
  modeServer,
  paramKeyDebug,
  paramKeyDualTrip,
  paramKeyHelp,
  paramKeyHost,
  paramKeyInterval,
  paramKeyMode,
  paramKeyPort,
  paramKeyVersion,
  parseArgv,
} from "./argparse";
import packageDescriptor from "../package.json";
import { checkPktSpec } from "./pdu";
import { LatencyMeasurer } from "./client";
import { ConnectionManager } from "./server";

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
    const dual = cliParams.some((p) => p.key === paramKeyDualTrip);
    const srvMng = new ConnectionManager(portNum, dual);
    srvMng.start();
  } else {
    console.error("Unknown mode:" + mode);
    process.exit(1);
  }

  return;
}

main();
