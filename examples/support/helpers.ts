export function waitUntilAbort(signal: AbortSignal, onAbort?: () => void): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      onAbort?.();
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        onAbort?.();
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}
