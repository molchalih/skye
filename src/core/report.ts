// What an EventTarget does with a throwing listener: report it as uncaught and carry on with the next one.
// `reportError` reaches the scope's "error" event and the console in windows and workers alike; without it,
// a rethrow from a microtask is the closest equivalent.
export function report(error: unknown): void {
  if (typeof globalThis.reportError === "function") globalThis.reportError(error);
  else
    queueMicrotask(() => {
      throw error;
    });
}
