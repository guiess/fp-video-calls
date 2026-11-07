import { CallAuthorizationError } from "./call-authorization.js";

export const CALL_WORK_LIMITS = Object.freeze({
  MAX_PROVIDER_OPERATIONS: 256,
  MAX_QUEUED_OPERATIONS: 1024,
  MAX_REQUESTS: 512,
  AUTH_MS: 15_000,
  ACTION_MS: 60_000,
  MAX_PAYLOAD_BYTES: 65_536,
});

/** Abort logical waits at a fixed deadline without pretending submitted provider work was undone. */
export class CallDeadline {
  constructor({ timeoutMs, code, status = 504, now = () => Date.now() }) {
    this.now = now;
    this.controller = new AbortController();
    this.reset(timeoutMs, code, status);
  }

  reset(timeoutMs, code, status = 504) {
    clearTimeout(this.timer);
    this.deadline = this.now() + Math.max(0, timeoutMs);
    this.failure = new CallAuthorizationError(code, status);
    this.timer = setTimeout(() => this.controller.abort(this.failure), Math.max(0, timeoutMs));
    this.timer.unref?.();
  }

  check() {
    if (this.now() >= this.deadline && !this.controller.signal.aborted) this.controller.abort(this.failure);
    if (this.controller.signal.aborted) throw this.controller.signal.reason;
  }

  async wait(promise) {
    promise.catch(() => {}); // A late provider rejection is already represented by the timeout outcome.
    this.check();
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = () => reject(this.controller.signal.reason); });
    this.controller.signal.addEventListener("abort", rejectAbort, { once: true });
    try {
      const result = await Promise.race([promise, aborted]);
      this.check();
      return result;
    } finally {
      this.controller.signal.removeEventListener("abort", rejectAbort);
    }
  }

  close() {
    clearTimeout(this.timer);
  }
}

/** No waiting acquisition queue: physical provider work remains counted until it actually settles. */
export class CallWorkPool {
  #active = 0;
  constructor(max = CALL_WORK_LIMITS.MAX_PROVIDER_OPERATIONS) { this.max = max; }

  async run(start, scope) {
    scope.check();
    if (this.#active >= this.max) throw new CallAuthorizationError("CALL_WORK_CAPACITY", 503);
    this.#active++;
    const actual = Promise.resolve().then(() => { scope.check(); return start(); });
    const tracked = actual.finally(() => { this.#active--; });
    return scope.wait(tracked);
  }

  get activeCount() { return this.#active; }
}

/** FIFO record delivery is bounded separately from provider operations and duplicate HTTP waits. */
export class CallDeliveryQueue {
  #active = 0;
  async enqueue(record, scope, operation) {
    scope.check();
    if (this.#active >= CALL_WORK_LIMITS.MAX_QUEUED_OPERATIONS) {
      return Promise.reject(new CallAuthorizationError("CALL_QUEUE_CAPACITY", 503));
    }
    this.#active++;
    const actual = record.delivery.then(() => { scope.check(); return operation(); });
    const tracked = actual.finally(() => { this.#active--; });
    // Each request/receipt observes its own failure; later authorized actions must still run.
    record.delivery = tracked.catch(() => {});
    return scope.wait(tracked);
  }
}

/** Cache one outcome per original recipient so valid replays reflect the original delivery. */
export function createDeliveryReceipt() {
  let resolve;
  let reject;
  let isSettled = false;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  // A timed-out/disconnected request may no longer await its cached receipt.
  promise.catch(() => {});
  return {
    promise,
    succeed() { if (!isSettled) { isSettled = true; resolve(); } },
    fail(error) { if (!isSettled) { isSettled = true; reject(error); } },
  };
}
