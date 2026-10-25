export { SmtpConfigRepository } from "./smtp-config.repository";
export { SmtpConfigService } from "./smtp-config.service";
export { createSmtpConfigController } from "./smtp-config.controller";
export type { SmtpConfigInput, SmtpConfigUpdateInput, SmtpConfigRecord, ISmtpConfigRepository } from "./smtp-config.types";
export {
  DEFAULT_SMTP_PORT,
  SMTP_PORTS,
  SMTP_SECURITIES,
  defaultSecurityFor,
  isAllowedSmtpPort,
  parseSmtpHostname,
} from "./smtp-host";
export type { SmtpSecurity } from "./smtp-host";
export {
  COMMON_DKIM_SELECTORS,
  DohDnsResolver,
  runDnsCheck,
} from "./dns-check";
export type { DnsCheckItem, DnsCheckResult, DnsCheckStatus, IDnsResolver } from "./dns-check";
export {
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
  buildSmtpTransportOptions,
  checkSmtpConnection,
  classifySmtpError,
  createSmtpTransport,
  sendTestEmail,
} from "./smtp-connection";
