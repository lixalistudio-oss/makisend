import { getSendEmailFunction, getSendEmailTimeoutFunction } from "./send-email";
import {
  getCreateSmtpConfigFunction,
  getUpdateSmtpConfigFunction,
  getDeleteSmtpConfigFunction,
  getGetSmtpConfigByIdFunction,
  getGetSmtpConfigsByUserIdFunction,
} from "./smtp-config";

export function getFunctions() {
  return [
    getSendEmailFunction(),
    getSendEmailTimeoutFunction(),
    getCreateSmtpConfigFunction(),
    getUpdateSmtpConfigFunction(),
    getDeleteSmtpConfigFunction(),
    getGetSmtpConfigByIdFunction(),
    getGetSmtpConfigsByUserIdFunction(),
  ];
}
