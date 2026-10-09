import { Inngest, dependencyInjectionMiddleware } from "inngest";
import { pinoLogger } from "@/core/logger";
import { AppError } from "@/core/errors";
import type {
  IEmailRepository,
  IEmailTransport,
  SendEmailQueueMessage,
} from "@/send-email/send-email.types";
import type { ISmtpConfigRepository } from "@/smtp-config/smtp-config.types";

export type TransportResolver = (smtpConfigId?: string) => Promise<IEmailTransport>;

let _inngest: Inngest | null = null;

let transport: IEmailTransport | null = null;
// Legacy fallback: whatever transport this isolate was warmed up with. Kept so
// callers that never pass a resolver (and events queued before smtpConfigId
// existed) keep working instead of crashing on a null transport.
const fallbackTransportResolver: TransportResolver = async () => {
  if (!transport) {
    throw new AppError(500, "Email transport is not initialized");
  }
  return transport;
};
let resolveTransportDep: TransportResolver = fallbackTransportResolver;
let emailRepository: IEmailRepository | null = null;
let smtpConfigRepository: ISmtpConfigRepository | null = null;
let aesKey: string | null = null;
let sendEmailQueue: Queue<SendEmailQueueMessage> | null = null;

function initInngest() {
  if (_inngest) return;

  _inngest = new Inngest({
    id: "makisend",
    logger: pinoLogger,
    middleware: [
      dependencyInjectionMiddleware({
        // Use getters so deps are resolved at execution time, not creation time
        get transport() { return transport!; },
        get resolveTransport() { return resolveTransportDep; },
        get emailRepository() { return emailRepository!; },
        get smtpConfigRepository() { return smtpConfigRepository!; },
        get aesKey() { return aesKey!; },
        // Used by onFailure / the timeout companion to bounce a message back
        // onto the Cloudflare Queue for another 30s cycle.
        get sendEmailQueue() { return sendEmailQueue!; },
      }),
    ],
  });
}

export function configureDeps(
  t: IEmailTransport,
  r: IEmailRepository,
  k: string,
  scr: ISmtpConfigRepository,
  resolver?: TransportResolver,
  queue?: Queue<SendEmailQueueMessage>,
) {
  transport = t;
  emailRepository = r;
  aesKey = k;
  smtpConfigRepository = scr;
  // The send-email function asks for a transport per event (`smtpConfigId`), so it
  // never reuses a stale per-isolate singleton. Callers that don't provide a
  // resolver keep the legacy behaviour: whatever transport was injected here.
  resolveTransportDep = resolver ?? fallbackTransportResolver;
  sendEmailQueue = queue ?? sendEmailQueue;
  initInngest();
}

export function getInngestClient(): Inngest {
  if (!_inngest) {
    initInngest();
  }
  return _inngest!;
}
