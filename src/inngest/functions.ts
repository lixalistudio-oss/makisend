import { getSendEmailFunction } from "./send-email";

export function getFunctions() {
  return [
    getSendEmailFunction(),
  ];
}
