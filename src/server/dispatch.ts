import { IApplication, PipeSetup } from "../shared_types";
import { Cancellation } from "../cancellation";
import { ServerApplication as TCPServerApplication } from "./tcp_srv";
import { ServerApplication as WSServerApplication } from "./ws_srv";
import { ServerApplication as H2ServerApplication } from "./h2_srv";
import { connectSelf, connectTimestampping } from "../wiring";

export const transportTCP = "tcp";
export const transportWS = "ws";
export const transportHTTP2 = "h2";

export type TransportLayerProtocol =
  | typeof transportTCP
  | typeof transportWS
  | typeof transportHTTP2;

export class ServerApplication implements IApplication {
  private backend: IApplication;

  constructor(
    public readonly portNum: number,
    public readonly dualTrip: boolean,
    public readonly transport: TransportLayerProtocol
  ) {
    const wiring: PipeSetup = dualTrip ? connectTimestampping : connectSelf;

    if (transport === transportWS) {
      this.backend = new WSServerApplication(portNum, wiring);
    } else if (transport === transportHTTP2) {
      this.backend = new H2ServerApplication(portNum, wiring);
    } else if (transport === transportTCP) {
      this.backend = new TCPServerApplication(portNum, wiring);
    } else {
      console.error("Unknown transport:", transport);
      process.exit(1);
    }
  }

  start(): Cancellation {
    return this.backend.start();
  }
}
