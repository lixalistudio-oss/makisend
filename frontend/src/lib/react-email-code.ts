export type { ReactEmailCodeSnapshot } from "./react-email-code.types";

import type {
  ReactEmailCodeRequest,
  ReactEmailCodeResponse,
  ReactEmailCodeSnapshot,
} from "./react-email-code.types";

interface Pending {
  resolve: (value: ReactEmailCodeSnapshot) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(error: Error) {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("./react-email-code.worker.ts", import.meta.url), {
    type: "module",
  });

  worker.onmessage = (event: MessageEvent<ReactEmailCodeResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);

    if (message.ok) {
      entry.resolve({
        html: message.html,
        text: message.text,
        variables: message.variables,
      });
    } else {
      entry.reject(new Error(message.error));
    }
  };

  worker.onerror = (event) => {
    const detail =
      event.error instanceof Error && event.error.stack
        ? `\n${event.error.stack}`
        : "";
    failAll(
      new Error(
        event.message
          ? `The preview sandbox crashed: ${event.message}${detail}`
          : "The preview sandbox crashed.",
      ),
    );
    worker?.terminate();
    worker = null;
  };

  worker.onmessageerror = () => {
    failAll(new Error("The preview sandbox returned an unreadable message."));
    worker?.terminate();
    worker = null;
  };

  return worker;
}

export function renderReactEmailCode(
  code: string,
  timeoutMs = 10_000,
): Promise<ReactEmailCodeSnapshot> {
  return new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;

    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Preview timed out after 10 seconds."));
      worker?.terminate();
      worker = null;
    }, timeoutMs);

    pending.set(id, { resolve, reject, timer });

    try {
      const request: ReactEmailCodeRequest = { id, code };
      getWorker().postMessage(request);
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
