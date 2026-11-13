import { afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  uploadData: vi.fn(),
  createIfNotExists: vi.fn(),
  blob: { url: "https://synthetic.invalid/fixture" },
}));
vi.mock("@azure/storage-blob", async importOriginal => {
  const sdk = await importOriginal();
  return {
    ...sdk,
    BlobServiceClient: { fromConnectionString: () => ({
      accountName: "synthetic",
      getContainerClient: () => ({
        createIfNotExists: mock.createIfNotExists,
        getBlockBlobClient: () => ({ ...mock.blob, uploadData: mock.uploadData }),
      }),
    }) },
  };
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

async function adapter(connection = "AccountName=synthetic;AccountKey=c3ludGhldGljLW5vdC1hLWNyZWRlbnRpYWw=") {
  vi.resetModules();
  vi.stubEnv("AZURE_STORAGE_CONNECTION_STRING", connection);
  return import("../blob-storage.js");
}

describe("synthetic Blob upload/signing contract", () => {
  it("creates an immutable key and safely encodes upload-label disposition", async () => {
    const { uploadBlob } = await adapter();
    const bytes = Buffer.from("fixture");
    await uploadBlob("fixture.txt", bytes, "text/plain", "report 'one' (copy).txt");
    expect(mock.uploadData).toHaveBeenCalledWith(bytes, {
      conditions: { ifNoneMatch: "*" },
      blobHTTPHeaders: {
        blobContentType: "text/plain",
        blobContentDisposition: "inline; filename*=UTF-8''report%20%27one%27%20%28copy%29.txt",
      },
    });
  });

  it("does not fall back to an unsigned URL when the signing credential is absent", async () => {
    const { generateSasUrl } = await adapter("AccountName=synthetic");
    await expect(generateSasUrl("fixture.txt")).rejects.toThrow("signing credential");
  });

  it("reports conditional-create collisions distinctly so compensation cannot delete old objects", async () => {
    const { uploadBlob } = await adapter();
    mock.uploadData.mockRejectedValueOnce(Object.assign(new TypeError("synthetic condition failure"), { statusCode: 412 }));
    await expect(uploadBlob("fixture.txt", Buffer.from("new"), "text/plain", "fixture.txt"))
      .rejects.toMatchObject({ code: "STORAGE_OBJECT_EXISTS" });
  });

  it("issues only a read-only expiring SAS", async () => {
    const { generateSasUrl } = await adapter();
    const url = new URL(await generateSasUrl("fixture.txt", 60));
    expect(url.searchParams.get("sp")).toBe("r");
    expect(Date.parse(url.searchParams.get("se"))).toBeGreaterThan(Date.now());
    expect(url.searchParams.has("sig")).toBe(true);
  });
});
