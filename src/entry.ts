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
  paramKeyHttp2,
  paramKeyHttp2Uri,
  paramKeyInterval,
  paramKeyMode,
  paramKeyPort,
  paramKeyVersion,
  paramKeyWS,
  paramKeyWSUri,
  parseArgv,
} from "./argparse";
import packageDescriptor from "../package.json";
import { checkPktSpec } from "./pdu";
import { ClientApplication, ClientApplicationInitOptions } from "./client";
import {
  ServerApplication,
  TransportLayerProtocol,
  transportHTTP2,
  transportTCP,
  transportWS,
} from "./server";
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

  const wsUri = cliParams.find((p) => p.key === paramKeyWSUri)?.value as string;
  const h2Uri = cliParams.find((p) => p.key === paramKeyHttp2Uri)
    ?.value as string;

  let transport: TransportLayerProtocol = transportTCP;
  if (!!wsUri || cliParams.some((p) => p.key === paramKeyWS)) {
    console.log("Will use WebSocket as transport.");
    transport = transportWS;
  } else if (!!h2Uri || cliParams.some((p) => p.key === paramKeyHttp2)) {
    console.log("Will use HTTP2 as transport.");
    transport = transportHTTP2;
  } else {
    console.log("Will use TCP as transport. (by default)");
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
    if (transport === transportWS) {
      if (!wsUri) {
        console.error("Invalid WebSocket URI or it is not provided.");
        process.exit(1);
      }
      cliOpts.ws = { uri: wsUri };
      endpointStr = wsUri;
    } else if (transport === transportHTTP2) {
      if (!h2Uri) {
        console.error("Invalid HTTP2 URI or it is not provided.");
        process.exit(1);
      }
      cliOpts.h2 = { uri: h2Uri };
      endpointStr = h2Uri;
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
    const srvMng = new ServerApplication(portNum, dual, transport);
    const { dispose: disposeSrv } = srvMng.start();
    appendCancellation(appCtx, disposeSrv);
  } else {
    console.error("Unknown mode:" + mode);
    printUsage(true);
    process.exit(1);
  }
}

main();
