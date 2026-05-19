import type { Id } from "../_generated/dataModel";

/**
 * Type alias for Convex File Storage IDs. Use this instead of raw
 * `Id<"_storage">` in code outside Convex entity files (per the
 * `convex-document-types` skill — raw `Id<>` only appears in entity files).
 *
 * `_storage` is a built-in Convex table, not a user-defined entity, so it has
 * no `domain.ts` to host this alias — `convex/lib/storage.ts` is the closest
 * equivalent home.
 */
export type StorageId = Id<"_storage">;
