import { Inngest, dependencyInjectionMiddleware } from "inngest";
import { pinoLogger } from "@/core/logger";
import type { IEmailRepository, IEmailTransport } from "@/send-email/send-email.types";
import type { ISmtpConfigRepository } from "@/smtp-config/smtp-config.types";

let _inngest: Inngest | null = null;

let transport: IEmailTransport | null = null;
let emailRepository: IEmailRepository | null = null;
let smtpConfigRepository: ISmtpConfigRepository | null = null;
let aesKey: string | null = null;

function initInngest() {
  if (_inngest) return;

  _inngest = new Inngest({
    id: "makisend",
    logger: pinoLogger,
    middleware: [
      dependencyInjectionMiddleware({
        // Use getters so deps are resolved at execution time, not creation time
        get transport() { return transport!; },
        get emailRepository() { return emailRepository!; },
        get smtpConfigRepository() { return smtpConfigRepository!; },
        get aesKey() { return aesKey!; },
      }),
    ],
  });
}

export function configureDeps(
  t: IEmailTransport,
  r: IEmailRepository,
  k: string,
  scr: ISmtpConfigRepository,
) {
  transport = t;
  emailRepository = r;
  aesKey = k;
  smtpConfigRepository = scr;
  initInngest();
}

export function getInngestClient(): Inngest {
  if (!_inngest) {
    initInngest();
  }
  return _inngest!;
}
