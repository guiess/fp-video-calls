import { describe, expect, it, vi } from "vitest";
import { cancelCall } from "../callService";

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../api", () => ({ apiFetch: api.fetch, getBaseUrl: () => "https://example.test" }));

describe("cancellation transport diagnostics", () => {
  it.each([403, 409, 502])("reports HTTP %s rather than silently claiming cancellation", async status => {
    api.fetch.mockResolvedValue({ ok: false, status });
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    await cancelCall(["alice"], "room", "uuid");
    expect(log).toHaveBeenCalledWith("[call/cancel] Request rejected", status);
    log.mockRestore();
  });

  it("reports network failure without provider data", async () => {
    api.fetch.mockRejectedValue(new Error("synthetic private detail"));
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    await cancelCall(["alice"], "room", "uuid");
    expect(log).toHaveBeenCalledExactlyOnceWith("[call/cancel] Request failed");
    log.mockRestore();
  });
});
