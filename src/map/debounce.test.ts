import { describe, expect, test } from "bun:test";

import { createDebouncedCallback, type DebounceScheduler } from "@/map/debounce";

function scheduler(): DebounceScheduler & { run(): void } {
  let callback: (() => void) | null = null;
  return {
    set(next) {
      callback = next;
      return next;
    },
    clear(handle) {
      if (callback === handle) callback = null;
    },
    run() {
      const next = callback;
      callback = null;
      next?.();
    },
  };
}

describe("map viewport debounce", () => {
  test("emits only the final value from a burst", () => {
    const clock = scheduler();
    const received: number[] = [];
    const debounced = createDebouncedCallback((value: number) => received.push(value), 250, clock);

    debounced.call(1);
    debounced.call(2);
    debounced.call(3);
    clock.run();

    expect(received).toEqual([3]);
  });

  test("cancels pending work deterministically", () => {
    const clock = scheduler();
    const received: string[] = [];
    const debounced = createDebouncedCallback((value: string) => received.push(value), 250, clock);

    debounced.call("latest");
    debounced.cancel();
    clock.run();

    expect(received).toEqual([]);
  });
});
