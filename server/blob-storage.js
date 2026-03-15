/**
 * Azure Blob Storage adapter with local filesystem fallback.
 *
 * When AZURE_STORAGE_CONNECTION_STRING is set, files are stored in Azure Blob Storage.
 * Otherwise, falls back to local filesystem (backward compatible).
 *
 * @module blob-storage
 */
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} from "@azure/storage-blob";
import fs from "fs";
import path from "path";
import { Readable } from "stream";

const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER || "chat-files";
const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING || "";

let _containerClient = null;
let _blobServiceClient = null;

/**
 * Returns true if Azure Blob Storage is configured.
 * @returns {boolean}
 */
export function isBlobStorageConfigured() {
  return CONNECTION_STRING.length > 0;
}

/**
 * Lazily initializes and returns the Azure BlobServiceClient.
 * @returns {import("@azure/storage-blob").BlobServiceClient}
 */
function getBlobServiceClient() {
  if (!_blobServiceClient) {
    _blobServiceClient = BlobServiceClient.fromConnectionString(CONNECTION_STRING);
  }
  return _blobServiceClient;
}

/**
 * Lazily initializes and returns the Azure ContainerClient.
 * Creates the container if it doesn't exist.
 * @returns {Promise<import("@azure/storage-blob").ContainerClient>}
 */
async function getContainerClient() {
  if (!_containerClient) {
    const serviceClient = getBlobServiceClient();
    _containerClient = serviceClient.getContainerClient(CONTAINER_NAME);
    await _containerClient.createIfNotExists({ access: undefined });
  }
  return _containerClient;
}

/**
 * Uploads a buffer to Azure Blob Storage.
 *
 * @param {string} fileName - The blob name (unique identifier + extension).
 * @param {Buffer} buffer - File content as a Buffer.
 * @param {string} contentType - MIME content type (e.g. "image/jpeg").
 * @returns {Promise<string>} The blob URL.
 */
export async function uploadBlob(fileName, buffer, contentType, originalName) {
  const containerClient = await getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(fileName);
  const headers = { blobContentType: contentType };
  if (originalName) {
    headers.blobContentDisposition = `inline; filename="${originalName}"`;
  }
  await blockBlobClient.uploadData(buffer, { blobHTTPHeaders: headers });
  return blockBlobClient.url;
}

/**
 * Downloads a blob as a readable stream.
 *
 * @param {string} fileName - The blob name.
 * @returns {Promise<import("stream").Readable>} A Node.js readable stream.
 */
export async function downloadBlob(fileName) {
  const containerClient = await getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(fileName);
  const response = await blockBlobClient.download(0);
  return response.readableStreamBody;
}

/**
 * Deletes a blob from Azure Blob Storage.
 *
 * @param {string} fileName - The blob name.
 * @returns {Promise<void>}
 */
export async function deleteBlob(fileName) {
  const containerClient = await getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(fileName);
  await blockBlobClient.deleteIfExists({ deleteSnapshots: "include" });
}

/**
 * Generates a time-limited SAS URL for secure blob access.
 *
 * @param {string} fileName - The blob name.
 * @param {number} [expiresInMinutes=60] - How long the URL should be valid.
 * @returns {Promise<string>} The SAS URL for the blob.
 */
export async function generateSasUrl(fileName, expiresInMinutes = 60) {
  const containerClient = await getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(fileName);

  // Use user-delegation SAS if possible, otherwise fall from connection string
  const startsOn = new Date();
  startsOn.setMinutes(startsOn.getMinutes() - 5); // clock skew buffer
  const expiresOn = new Date();
  expiresOn.setMinutes(expiresOn.getMinutes() + expiresInMinutes);

  // Parse the connection string to get account name and key for SAS generation
  const serviceClient = getBlobServiceClient();
  const accountName = serviceClient.accountName;

  // Extract the shared key credential from the connection string
  const keyMatch = CONNECTION_STRING.match(/AccountKey=([^;]+)/);
  if (!keyMatch) {
    // Fall back to returning the blob URL directly (works if container has public access)
    return blockBlobClient.url;
  }

  const sharedKeyCredential = new StorageSharedKeyCredential(
    accountName,
    keyMatch[1]
  );

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER_NAME,
      blobName: fileName,
      permissions: BlobSASPermissions.parse("r"),
      startsOn,
      expiresOn,
    },
    sharedKeyCredential
  ).toString();

  return `${blockBlobClient.url}?${sasToken}`;
}

// ── Local filesystem fallback functions ─────────────────────────────────────

/**
 * Uploads a buffer to local filesystem.
 *
 * @param {string} fileName - File name to store.
 * @param {Buffer} buffer - File content.
 * @param {string} uploadDir - Directory to store files.
 * @returns {string} Relative download URL path.
 */
export function uploadLocal(fileName, buffer, uploadDir) {
  const filePath = path.join(uploadDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return `/api/chat/files/${fileName}`;
}

/**
 * Returns a readable stream from local filesystem.
 *
 * @param {string} fileName - File name.
 * @param {string} uploadDir - Directory where files are stored.
 * @returns {import("fs").ReadStream|null} Stream or null if not found.
 */
export function downloadLocal(fileName, uploadDir) {
  const filePath = path.join(uploadDir, path.basename(fileName));
  if (!fs.existsSync(filePath)) return null;
  return fs.createReadStream(filePath);
}

/**
 * Deletes a file from local filesystem.
 *
 * @param {string} fileName - File name.
 * @param {string} uploadDir - Directory where files are stored.
 */
export function deleteLocal(fileName, uploadDir) {
  const filePath = path.join(uploadDir, path.basename(fileName));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

/**
 * For local storage, returns the standard download path (no SAS needed).
 *
 * @param {string} fileName - File name.
 * @returns {string} Download URL path.
 */
export function getLocalDownloadUrl(fileName) {
  return `/api/chat/files/${fileName}`;
}
