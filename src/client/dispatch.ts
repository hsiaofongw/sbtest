import { Cancellation } from "../cancellation";
import { IApplication } from "../shared_types";
import { ClientApplication as H2ClientApplication } from "./h2_cli";
import { ClientApplication as WSClientApplication } from "./ws_cli";
import { ClientApplication as TCPClientApplication } from "./tcp_cli";
import { connectCliPing } from "../wiring";
import { getPortNum } from "../utils";

export type ClientApplicationInitOptions = {
  uri: string;
  pingIntervalMs: number;
};

export class ClientApplication implements IApplication {
  private appImpl: IApplication;

  constructor(public readonly opts: ClientApplicationInitOptions) {
    const wiring = connectCliPing(opts.pingIntervalMs);
    try {
      const urlObj = new URL(opts.uri);
      const proto = urlObj.protocol;
      if (["https:", "http:"].includes(proto)) {
        this.appImpl = new H2ClientApplication(opts.uri, wiring);
      } else if (["wss:", "ws:"].includes(proto)) {
        this.appImpl = new WSClientApplication(opts.uri, wiring);
      } else if (proto === "tcp:") {
        const portNum = getPortNum(urlObj.port);
        if (!portNum) {
          console.error(`Invalid port.`);
          process.exit(1);
        }

        this.appImpl = new TCPClientApplication(
          urlObj.hostname,
          portNum,
          wiring
        );
      } else {
        console.error(`Expected a valid URI like: <proto>://<hostname>:<port>`);
        process.exit(1);
      }
    } catch (err) {
      console.error("Error while initializing client app:", err);
      process.exit(1);
    }
  }

  public start(): Cancellation {
    return this.appImpl.start();
  }
}
