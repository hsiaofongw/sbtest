import {
  defaultArgDefines,
  getArgDescriptionLine,
  getConnectionURI,
  getEnableServerTimestamp,
  getListenPort,
  getPingInterval,
  getTransport,
  getWorkingMode,
  modeClient,
  modeServer,
  paramKeyDebug,
  paramKeyHelp,
  paramKeyVersion,
  parseArgv,
} from "./argparse";
import packageDescriptor from "../package.json";
import { checkPktSpec } from "./pdu";
import { ClientApplication } from "./client/dispatch";
import { ServerApplication } from "./server/dispatch";
import { Cancellation } from "./cancellation";

function printVersion() {
  console.log(packageDescriptor?.version ?? "Unknown");
}

type ExampleCommand = {
  description: string;
  command: string;
};

function getExampleCommandLines(cmd: ExampleCommand): string[] {
  return [cmd.description, cmd.command];
}

const exampleCmds: ExampleCommand[] = [
  {
    description: "Print help:",
    command: "node script.js --help",
  },
  {
    description:
      "Connects to a TCP endpoint which provides echo service, ping the endpoint every 1000 milliseconds:",
    command: "node script.js --connect tcp://localhost:13428 --interval 1000",
  },
  {
    description:
      "Connects to a WebSocket endpoint which provides echo service, ping the endpoint every 1000 milliseconds:",
    command: "node script.js --connect ws://127.0.0.1:31428 ---interval 1000",
  },
  {
    description:
      "Connects to a HTTP2 endpoint which provideds echo service, ping the endpoint every 1000 milliseconds:",
    command: "node script.js --connect http://127.0.0.1:41827 --interval 1000",
  },
  {
    description:
      "Launch an echo server with TCP as its transport, listening at TCP port 12345:",
    command: "node script.js --listen --port 12345",
  },
  {
    description:
      "Launch an echo server with WebSocket as its transport, listening at TCP port 12346:",
    command: "node script.js --listen --port 12346 --websocket",
  },
  {
    description:
      "Launch an echo server with HTTP2 as its transport, listening at TCP port 12347:",
    command: "node script.js --listen --port 12347 --http2",
  },
  {
    description:
      "Launch a timestamp server with HTTP2 as its transport, listening at TCP port 12348:",
    command: "node script.js --listen --port 12348 --http2 -D",
  },
];

function printUsage(err?: boolean) {
  const allowedUsages = [
    "node script.js --connect <uri> [--interval <intervalMs>]",
    "node script.js --listen --port <portNum> [--websocket] [--http2] [-D]",
    "node script.js --help",
  ];

  let usageTxt =
    "Usage:" +
    "\n\n" +
    allowedUsages.map((x) => `${" ".repeat(4)}${x}`).join("\n") +
    "\n\n\n" +
    "Parameters:" +
    "\n\n" +
    defaultArgDefines
      .map((argDef) => " ".repeat(4) + getArgDescriptionLine(argDef))
      .join("\n") +
    "\n\n\n" +
    "Examples:" +
    "\n\n" +
    exampleCmds
      .map((example, i) =>
        getExampleCommandLines(example)
          .map((l, j) => (j === 0 ? `Example ${i + 1}:  ${l}` : l))
          .map((l) => " ".repeat(4) + l)
          .map((l, i) => (i === 0 ? "\n" + l : l))
          .join("\n\n")
      )
      .join("\n\n");

  if (err) {
    console.error(usageTxt);
  } else {
    console.log(usageTxt);
  }
}

type AppCtx = {
  cancellation?: Cancellation;
};

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

  const debugBit = cliParams.find((p) => p.key === paramKeyDebug);
  if (debugBit) {
    console.debug("Parsed Cli Parameters:", cliParams);
  }

  const now = new Date();
  console.log(`Launched at ${now.toISOString()}`);

  const mode = getWorkingMode(cliParams);
  console.log(`Mode: ${mode}`);

  const appCtx: AppCtx = {};

  if (mode === modeServer) {
    const transport = getTransport(cliParams);
    console.log(`Transport: ${transport}`);

    const listenPort = getListenPort(cliParams);
    if (!listenPort) {
      console.error("Invalid listen port");
      process.exit(1);
    }

    console.log(`Listen port: ${listenPort}`);

    const enableSrvTx = getEnableServerTimestamp(cliParams);
    console.log(`Enable server timestampping: ${enableSrvTx}`);

    const app = new ServerApplication(listenPort, enableSrvTx, transport);
    appCtx.cancellation = app.start();
  } else if (mode === modeClient) {
    const connUri = getConnectionURI(cliParams);
    if (!connUri) {
      console.error("Invalid connection uri.");
      process.exit(1);
    }

    console.log(`Endpoint: ${connUri}`);

    const pingInterval = getPingInterval(cliParams);
    if (!pingInterval) {
      console.error("Invalid ping interval.");
      process.exit(1);
    }

    console.log(`Ping interval: ${pingInterval}(ms)`);

    const app = new ClientApplication({
      pingIntervalMs: pingInterval,
      uri: connUri,
    });
    appCtx.cancellation = app.start();
  } else {
    printUsage(true);
    console.error("\n\nUnknown working mode.\n\n");
    process.exit(1);
  }

  process.on("SIGINT", () => {
    console.log("Caught SIGINT, gracefully shutting down itself...");
    if (appCtx) {
      appCtx.cancellation?.dispose?.();
    }
  });
}

main();
