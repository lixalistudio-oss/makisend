import { getSendEmailFunction, getSendEmailTimeoutFunction } from "./send-email";

export function getFunctions() {
  return [getSendEmailFunction(), getSendEmailTimeoutFunction()];
}
