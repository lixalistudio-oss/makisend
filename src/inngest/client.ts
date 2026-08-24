import { Inngest, dependencyInjectionMiddleware } from "inngest";
import { pinoLogger } from "@/core/logger";
import { AppError } from "@/core/errors";
import type { IEmailRepository, IEmailTransport } from "@/send-email/send-email.types";

let _inngest: Inngest | null = null;

let transport: IEmailTransport | null = null;
let repository: IEmailRepository | null = null;
let aesKey: string | null = null;

function initInngest() {
  if (_inngest) return;

  _inngest = new Inngest({
    id: "makisend",
    logger: pinoLogger,
    middleware: [
      dependencyInjectionMiddleware({ transport: transport!, repository: repository!, aesKey: aesKey! }),
    ],
  });
}

export function configureDeps(
  t: IEmailTransport,
  r: IEmailRepository,
  k: string,
) {
  transport = t;
  repository = r;
  aesKey = k;
  initInngest();
}

export function getInngestClient(): Inngest {
  if (!_inngest) {
    pinoLogger.error("Inngest not initialized — call configureDeps() first");
    throw new AppError(500, "Inngest not initialized — call configureDeps() first");
  }
  return _inngest;
}
