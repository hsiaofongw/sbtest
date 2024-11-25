import { Cancellation } from "./cancellation";

export interface IApplication {
  start(): Cancellation;
}
