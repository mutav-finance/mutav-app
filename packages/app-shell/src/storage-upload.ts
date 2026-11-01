/**
 * Second leg of the Convex File Storage upload flow (mint URL → POST file →
 * record storageId): POSTs the file to a URL a mutation minted and returns the
 * `storageId` Convex answers with, or null when the upload or its response
 * fails.
 *
 * The id type stays the caller's: this package cannot see the backend's
 * generated `Id<"_storage">`, so the app passes the guard that narrows the
 * response string to its own storage id type.
 */
export async function postFileToStorage<TStorageId extends string>({
  uploadUrl,
  file,
  isStorageId,
}: {
  uploadUrl: string;
  file: File;
  isStorageId: (value: string) => value is TStorageId;
}): Promise<TStorageId | null> {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("storageId" in body)) return null;
  const { storageId } = body;
  if (typeof storageId !== "string" || !isStorageId(storageId)) return null;
  return storageId;
}
