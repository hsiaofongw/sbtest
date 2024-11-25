import {
  ValNode,
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
  paramKeyWS,
  paramKeyWSURI,
  parseArgv,
} from "./argparse";
import packageDescriptor from "../package.json";
import { checkPktSpec } from "./pdu";
import { ClientApplication, ClientApplicationInitOptions } from "./client";
import { ServerApplication } from "./server";
import {
  Cancellation,
  appendCancellation,
  makeCancellation,
} from "./cancellation";

function getPortNum(cliParams: ValNode[]): number | undefined {
  const portParam = cliParams.find((param) => param.key === paramKeyPort);
  const portNum: number = portParam?.value as any;
  if (!portParam || typeof portNum !== "number") {
    return undefined;
  }

  if (portNum < 0 || portNum > 2 ** 16) {
    return undefined;
  }

  return portNum;
}

function getHostParam(cliParams: ValNode[]): string {
  const hostParam = cliParams.find((param) => param.key === paramKeyHost);
  return String(hostParam?.value ?? "");
}

function getIntervalMs(cliParams: ValNode[]): number | undefined {
  const intervalMs: number =
    (cliParams.find((p) => p.key === paramKeyInterval)?.value as any) ??
    (defaultArgDefines.find((argDef) => argDef.fullKey === paramKeyInterval)
      ?.defaultValue as any);

  if (intervalMs < 1 || !Number.isFinite(intervalMs)) {
    return undefined;
  }

  return intervalMs;
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

  const debugBit = cliParams.find((p) => p.key === paramKeyDebug);
  if (debugBit) {
    console.debug("Parsed Cli Parameters:", cliParams);
  }

  const wsUri = cliParams.find((p) => p.key === paramKeyWSURI)?.value as string;
  const useWS = !!wsUri || cliParams.some((p) => p.key === paramKeyWS);
  if (useWS) {
    console.log("Will use WebSocket as transport.");
  } else {
  }

  const dual = cliParams.some((p) => p.key === paramKeyDualTrip);
  if (dual && mode === modeServer) {
    console.log(
      "Server would modify packets to enable the client working out single-trip delays."
    );
  }

  const now = new Date();
  const launchedAt = `Launched at ${now.toISOString()}`;

  const appCtx: Cancellation = makeCancellation();

  // handles Ctrl-C exit
  process.on("SIGINT", () => {
    console.log("Received SIGINT, gracefully exitting...");
    appCtx.dispose();
    process.exit(0);
  });

  if (mode === modeClient) {
    const intervalMs = getIntervalMs(cliParams);
    if (!intervalMs) {
      console.error("Invalid interval value or it is not provided.");
      process.exit(1);
    }

    const cliOpts: ClientApplicationInitOptions = {
      pingIntervalMs: intervalMs,
    };
    let endpointStr = "";
    if (useWS) {
      if (!wsUri) {
        console.error("Invalid websocket uri or it is not provided.");
        process.exit(1);
      }
      cliOpts.ws = { uri: wsUri };
      endpointStr = wsUri;
    } else {
      const portNum = getPortNum(cliParams);
      if (portNum === undefined) {
        console.error("Valid port number is required.");
        process.exit(1);
      }

      const host = getHostParam(cliParams) ?? "localhost";
      cliOpts.tcp = { host, portNum };
      endpointStr = `tcp://${host}:${portNum}`;
    }
    console.log(`${launchedAt}
Mode: ${mode}, IntervalMs: ${intervalMs}, Endpoint: ${endpointStr}`);
    const cli = new ClientApplication(cliOpts);
    const { dispose: disposeCli } = cli.start();
    appendCancellation(appCtx, disposeCli);
  } else if (mode === modeServer) {
    const portNum = getPortNum(cliParams);
    if (portNum === undefined) {
      console.error("Invalid port number to use or it is not provided.");
      process.exit(1);
    }
    console.log(`${launchedAt}
Mode: ${mode}, Port: ${portNum}`);
    const srvMng = new ServerApplication(portNum, dual, useWS);
    const { dispose: disposeSrv } = srvMng.start();
    appendCancellation(appCtx, disposeSrv);
  } else {
    console.error("Unknown mode:" + mode);
    printUsage(true);
    process.exit(1);
  }
}

main();
