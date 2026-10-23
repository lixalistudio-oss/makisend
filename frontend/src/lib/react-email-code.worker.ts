import "./disable-prism-worker-handler";
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as JsxDevRuntime from "react/jsx-dev-runtime";
import * as ReactEmail from "react-email";
import { transform } from "sucrase";
import type {
  ReactEmailCodeRequest,
  ReactEmailCodeResponse,
} from "./react-email-code.types";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ReactEmailCodeRequest>) => void) | null;
  postMessage: (message: ReactEmailCodeResponse) => void;
};

const post = scope.postMessage.bind(scope);

const sandbox = self as unknown as Record<string, unknown>;
const blockedNetworkApi = (name: string) => {
  const blocked = class {
    constructor() {
      throw new Error(`Network is disabled in the preview sandbox (${name}).`);
    }
  };
  try {
    Object.defineProperty(sandbox, name, { configurable: true, value: blocked });
  } catch {
    sandbox[name] = blocked;
  }
};

try {
  Object.defineProperty(sandbox, "fetch", {
    configurable: true,
    value: () => Promise.reject(new Error("Network is disabled in the preview sandbox.")),
  });
} catch {
  sandbox.fetch = () => Promise.reject(new Error("Network is disabled in the preview sandbox."));
}
sandbox.importScripts = () => {
  throw new Error("Network is disabled in the preview sandbox.");
};
for (const api of [
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "RTCPeerConnection",
  "WebTransport",
]) {
  blockedNetworkApi(api);
}
const workerNavigator = (self as unknown as { navigator?: Record<string, unknown> })
  .navigator;
if (workerNavigator) {
  try {
    Object.defineProperty(workerNavigator, "sendBeacon", {
      configurable: true,
      value: () => {
        throw new Error("Network is disabled in the preview sandbox.");
      },
    });
  } catch {
    // Older workers expose a non-configurable navigator; other network APIs stay blocked.
  }
}

const reactModule = React;
const jsxRuntimeModule = JsxRuntime;
const jsxDevRuntimeModule = JsxDevRuntime;
const reactEmailModule = ReactEmail;

function requireModule(specifier: string): unknown {
  switch (specifier) {
    case "react":
      return reactModule;
    case "react/jsx-runtime":
      return jsxRuntimeModule;
    case "react/jsx-dev-runtime":
      return jsxDevRuntimeModule;
    case "@react-email/components":
    case "@react-email/render":
    case "react-email":
      return reactEmailModule;
    default:
      throw new Error(
        `Import "${specifier}" is not allowed. Use @react-email/components and React only.`,
      );
  }
}

function variableNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (name): name is string =>
      typeof name === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function placeholderNames(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)].map(
    (match) => match[1],
  );
}

function restorePlaceholderCase(text: string, names: string[]): string {
  let normalized = text;
  for (const name of names) {
    const pattern = new RegExp(`\\{\\{\\s*${escapeRegExp(name)}\\s*\\}\\}`, "gi");
    normalized = normalized.replace(pattern, `{{${name}}}`);
  }
  return normalized;
}

async function renderCode(code: string) {
  const compiled = transform(code, {
    transforms: ["typescript", "jsx", "imports"],
    jsxRuntime: "automatic",
    production: true,
  }).code;

  const module = { exports: {} as Record<string, unknown> };
  const evaluator = new Function("require", "module", "exports", compiled);
  evaluator(requireModule, module, module.exports);

  const exported = module.exports;
  const Component = exported.default as
    | ((props: Record<string, unknown>) => unknown)
    | undefined;

  if (typeof Component !== "function") {
    throw new Error("The pasted code must export a default React component.");
  }

  const variables = [
    ...new Set([...variableNames(exported.variables), ...placeholderNames(code)]),
  ];
  const props = Object.fromEntries(variables.map((name) => [name, `{{${name}}}`]));
  const element = React.createElement(
    Component as import("react").ComponentType<Record<string, unknown>>,
    props,
  );

  const rawHtml = await ReactEmail.render(element);
  const [html, renderedText] = await Promise.all([
    ReactEmail.pretty(rawHtml),
    ReactEmail.toPlainText(rawHtml),
  ]);
  const text = restorePlaceholderCase(renderedText, variables);

  return { html, text, variables };
}

scope.onmessage = async (event) => {
  const { id, code } = event.data;
  try {
    const result = await renderCode(code);
    post({ id, ok: true, ...result });
  } catch (error) {
    post({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
