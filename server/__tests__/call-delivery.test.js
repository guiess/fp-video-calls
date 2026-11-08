import { afterEach, describe, expect, it, vi } from "vitest";
import { CallDeadline, CallWorkPool, CallDeliveryQueue, CALL_WORK_LIMITS } from "../call-delivery.js";

afterEach(() => vi.useRealTimers());

describe("bounded call delivery work", () => {
  it("settles never-resolving work at its deadline but retains physical work capacity until settlement", async () => {
    vi.useFakeTimers();
    const pool = new CallWorkPool();
    const scope = new CallDeadline({ timeoutMs: 100, code: "CALL_DELIVERY_TIMEOUT" });
    let resolve;
    const actual = new Promise(done => { resolve = done; });
    const result = pool.run(() => actual, scope).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    expect((await result).code).toBe("CALL_DELIVERY_TIMEOUT");
    expect(pool.activeCount).toBe(1);
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(pool.activeCount).toBe(0);
    scope.close();
  });

  it("caps physically pending provider work rather than releasing it on logical request expiry", async () => {
    vi.useFakeTimers();
    const pool = new CallWorkPool();
    const scopes = [];
    const pending = [];
    for (let index = 0; index < CALL_WORK_LIMITS.MAX_PROVIDER_OPERATIONS; index++) {
      const scope = new CallDeadline({ timeoutMs: 100, code: "CALL_DELIVERY_TIMEOUT" });
      scopes.push(scope);
      pending.push(pool.run(() => new Promise(() => {}), scope).catch(error => error));
    }
    expect(CALL_WORK_LIMITS.MAX_PROVIDER_OPERATIONS).toBe(256);
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all(pending);
    expect(pool.activeCount).toBe(256);
    const next = new CallDeadline({ timeoutMs: 100, code: "CALL_DELIVERY_TIMEOUT" });
    await expect(pool.run(() => Promise.resolve(), next)).rejects.toMatchObject({
      code: "CALL_WORK_CAPACITY", status: 503,
    });
    scopes.forEach(scope => scope.close()); next.close();
  });

  it("fences late continuations and cancels deadline resources on successful completion", async () => {
    vi.useFakeTimers();
    const scope = new CallDeadline({ timeoutMs: 100, code: "CALL_DELIVERY_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(100);
    expect(() => scope.check()).toThrow();
    const pool = new CallWorkPool();
    const start = vi.fn();
    await expect(pool.run(start, scope)).rejects.toMatchObject({ code: "CALL_DELIVERY_TIMEOUT" });
    expect(start).not.toHaveBeenCalled();
    scope.close();
    const completed = new CallDeadline({ timeoutMs: 100, code: "CALL_DELIVERY_TIMEOUT" });
    completed.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("caps queued operations and never starts a job after its wait deadline", async () => {
    vi.useFakeTimers();
    const queue = new CallDeliveryQueue();
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const record = { delivery: barrier };
    const operations = [];
    const scopes = [];
    const start = vi.fn();
    for (let index = 0; index < CALL_WORK_LIMITS.MAX_QUEUED_OPERATIONS; index++) {
      const scope = new CallDeadline({ timeoutMs: 100, code: "CALL_ACTION_TIMEOUT" });
      scopes.push(scope);
      operations.push(queue.enqueue(record, scope, start).catch(error => error));
    }
    expect(CALL_WORK_LIMITS.MAX_QUEUED_OPERATIONS).toBe(1024);
    const excess = new CallDeadline({ timeoutMs: 100, code: "CALL_ACTION_TIMEOUT" });
    await expect(queue.enqueue(record, excess, start)).rejects.toMatchObject({
      code: "CALL_QUEUE_CAPACITY", status: 503,
    });
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all(operations);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(start).not.toHaveBeenCalled();
    scopes.forEach(scope => scope.close()); excess.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});
