import { getSendEmailFunction } from "./send-email";
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
    getCreateSmtpConfigFunction(),
    getUpdateSmtpConfigFunction(),
    getDeleteSmtpConfigFunction(),
    getGetSmtpConfigByIdFunction(),
    getGetSmtpConfigsByUserIdFunction(),
  ];
}
