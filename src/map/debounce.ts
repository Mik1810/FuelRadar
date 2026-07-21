export type DebounceScheduler = {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
};

const browserScheduler: DebounceScheduler = {
  set: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clear: (handle) => window.clearTimeout(handle as number),
};

export type DebouncedCallback<T> = {
  call(value: T): void;
  cancel(): void;
};

/**
 * Keeps only the final viewport from a burst of Leaflet moveend events. It is
 * intentionally framework-free so nearby-query wiring can use the same rule.
 */
export function createDebouncedCallback<T>(
  callback: (value: T) => void,
  delayMs: number,
  scheduler: DebounceScheduler = browserScheduler,
): DebouncedCallback<T> {
  let timer: unknown = null;
  let lastValue: T | null = null;

  return {
    call(value) {
      lastValue = value;
      if (timer !== null) scheduler.clear(timer);
      timer = scheduler.set(() => {
        timer = null;
        if (lastValue === null) return;
        const valueToSend = lastValue;
        lastValue = null;
        callback(valueToSend);
      }, delayMs);
    },
    cancel() {
      if (timer !== null) scheduler.clear(timer);
      timer = null;
      lastValue = null;
    },
  };
}
