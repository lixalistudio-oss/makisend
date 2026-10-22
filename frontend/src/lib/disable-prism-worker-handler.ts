// react-email exports Prism-backed CodeBlock/CodeInline components. When Prism
// loads inside a worker it installs a global "message" listener and JSON.parses
// every message, which would consume our render requests. Tell it up front that
// this worker owns its message channel.
const workerScope = self as unknown as {
  Prism?: { disableWorkerMessageHandler?: boolean };
};

workerScope.Prism = {
  ...(workerScope.Prism ?? {}),
  disableWorkerMessageHandler: true,
};
