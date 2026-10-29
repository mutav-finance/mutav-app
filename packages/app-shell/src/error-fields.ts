const UNKNOWN_ERROR = "unknown";

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : UNKNOWN_ERROR;
}

export function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" && error.code !== "" ? error.code : null;
}

/** The SDK's `code` when it set one, else the error's class name. */
export function errorCodeOrName(error: unknown): string {
  return errorCode(error) ?? errorName(error);
}
