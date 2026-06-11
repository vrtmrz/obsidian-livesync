import type { FilePath } from "@lib/common/models/db.type";
/**
 * Path operations adapter interface
 * Handles path normalization and extraction
 */
export interface IPathAdapter<TNativeAbstractFile = unknown> {
    /**
     * Get the path from a file object or return the path string as-is
     */
    getPath(file: TNativeAbstractFile | string): FilePath;
    /**
     * Normalize a path according to the platform's conventions
     */
    normalisePath(path: string): string;
}
