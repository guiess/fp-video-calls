import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Firestore mock ──────────────────────────────────────────────────
// Mock the firebase module before importing the service under test.
// Pattern matches existing tests in this project (encryptionFormat.test.ts).
vi.mock("../../firebase", () => ({
  db: {} as any,
}));

// Track what getDoc resolves to so each test can control it.
let _getDocResult: { exists: () => boolean; data: () => any } = {
  exists: () => false,
  data: () => undefined,
};

vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_db: any, collection: string, docId: string) => ({
    _collection: collection,
    _docId: docId,
  })),
  getDoc: vi.fn(() => Promise.resolve(_getDocResult)),
}));

// Import after mocks are wired
import {
  getAppConfig,
  resetAppConfigCache,
  APP_CONFIG_DEFAULTS,
  type AppConfig,
} from "../appConfig";
import { doc, getDoc } from "firebase/firestore";

// ── Tests ───────────────────────────────────────────────────────────

describe("appConfig service", () => {
  beforeEach(() => {
    // Reset the in-memory cache between tests
    resetAppConfigCache();
    vi.clearAllMocks();
    _getDocResult = { exists: () => false, data: () => undefined };
  });

  // --- Acceptance Criteria 1: Defaults ---
  it("returns all default values when Firestore document does not exist", async () => {
    _getDocResult = { exists: () => false, data: () => undefined };

    const config = await getAppConfig();

    expect(config).toEqual(APP_CONFIG_DEFAULTS);
    expect(config.locationIntervalMinutes).toBe(10);
    expect(config.callTimeoutSeconds).toBe(45);
    expect(config.maxFileUploadMB).toBe(20);
    expect(config.locationHistoryDays).toBe(7);
  });

  // --- Acceptance Criteria 2: Full Firestore read ---
  it("returns Firestore values when the document exists with all fields", async () => {
    const firestoreData = {
      locationIntervalMinutes: 5,
      callTimeoutSeconds: 60,
      maxFileUploadMB: 50,
      locationHistoryDays: 14,
    };
    _getDocResult = { exists: () => true, data: () => firestoreData };

    const config = await getAppConfig();

    expect(config).toEqual(firestoreData);
  });

  // --- Acceptance Criteria 3: Partial Firestore data merges with defaults ---
  it("merges partial Firestore data with defaults for missing fields", async () => {
    _getDocResult = {
      exists: () => true,
      data: () => ({ callTimeoutSeconds: 90 }),
    };

    const config = await getAppConfig();

    expect(config.callTimeoutSeconds).toBe(90);
    // Missing fields should fall back to defaults
    expect(config.locationIntervalMinutes).toBe(10);
    expect(config.maxFileUploadMB).toBe(20);
    expect(config.locationHistoryDays).toBe(7);
  });

  // --- Acceptance Criteria 4: Caching ---
  it("caches the result and does not call Firestore again on second invocation", async () => {
    _getDocResult = {
      exists: () => true,
      data: () => ({ locationIntervalMinutes: 3 }),
    };

    const first = await getAppConfig();
    const second = await getAppConfig();

    expect(first).toStrictEqual(second);
    expect(getDoc).toHaveBeenCalledTimes(1);
  });

  // --- Acceptance Criteria 5: Firestore read failure returns defaults ---
  it("returns defaults when Firestore read throws an error", async () => {
    (getDoc as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network failure")
    );

    const config = await getAppConfig();

    expect(config).toEqual(APP_CONFIG_DEFAULTS);
  });

  // --- Edge: doc() called with the correct path ---
  it("reads from appConfig/settings document path", async () => {
    _getDocResult = { exists: () => false, data: () => undefined };

    await getAppConfig();

    expect(doc).toHaveBeenCalledWith(expect.anything(), "appConfig", "settings");
  });

  // --- Edge: resetAppConfigCache clears cache ---
  it("fetches fresh data after cache is reset", async () => {
    _getDocResult = {
      exists: () => true,
      data: () => ({ maxFileUploadMB: 100 }),
    };
    await getAppConfig();

    // Change remote data and reset cache
    _getDocResult = {
      exists: () => true,
      data: () => ({ maxFileUploadMB: 200 }),
    };
    resetAppConfigCache();

    const config = await getAppConfig();
    expect(config.maxFileUploadMB).toBe(200);
    expect(getDoc).toHaveBeenCalledTimes(2);
  });
});
