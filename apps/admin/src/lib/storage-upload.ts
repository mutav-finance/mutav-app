import type { StorageId } from "@convex/lib/storage";

function isStorageId(value: unknown): value is StorageId {
  return typeof value === "string" && value.length > 0;
}

/**
 * POST a file to a Convex upload URL. The `Content-Type` header is what Convex
 * records on the `_storage` row, and what the server checks the file against.
 * `null` on any transport or response-shape failure.
 */
export async function postToUploadUrl({
  uploadUrl,
  file,
}: {
  uploadUrl: string;
  file: File;
}): Promise<StorageId | null> {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("storageId" in body)) return null;
  return isStorageId(body.storageId) ? body.storageId : null;
}
