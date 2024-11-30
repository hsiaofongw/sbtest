import { Duplex } from "stream";
import { Cancellation } from "./cancellation";

export interface IApplication {
  start(): Cancellation;
}

export type PipeSetup = (duplex: Duplex) => Cancellation;
