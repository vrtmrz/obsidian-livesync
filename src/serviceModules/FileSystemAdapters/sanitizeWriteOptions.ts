import type { UXDataWriteOptions } from "@lib/common/types";

/**
 * Coerce the timestamp fields of a write-options object to integer milliseconds.
 *
 * On mobile, Obsidian forwards `mtime`/`ctime` to Capacitor's
 * Filesystem.setTimes, whose native binding casts the value to a Java `Long`.
 * A non-integer (float) timestamp makes that cast throw
 * `ClassCastException: Double cannot be cast to Long`, which crashes the app on
 * launch as soon as such a document is replicated in. Float timestamps can
 * enter the database from any client that stores `fs.Stats.mtimeMs` without
 * flooring. Flooring at the storage boundary guarantees every Obsidian write
 * carries an integer, so a float timestamp already present in the mesh cannot
 * brick the app.
 *
 * Returns a shallow copy so the caller's options object is not mutated; passes
 * `undefined` through unchanged.
 */
export function toIntegerTimestamps(options?: UXDataWriteOptions): UXDataWriteOptions | undefined {
    if (!options) return options;
    const sanitized: UXDataWriteOptions = { ...options };
    if (typeof sanitized.mtime === "number") sanitized.mtime = Math.floor(sanitized.mtime);
    if (typeof sanitized.ctime === "number") sanitized.ctime = Math.floor(sanitized.ctime);
    return sanitized;
}
