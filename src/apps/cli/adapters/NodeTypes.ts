import type { FilePath } from "@lib/common/models/db.type";
import type { UXStat } from "@lib/common/models/fileaccess.type";
/**
 * Node.js file representation
 */
export type NodeFile = {
    path: FilePath;
    stat: UXStat;
};

/**
 * Node.js folder representation
 */
export type NodeFolder = {
    path: FilePath;
    isFolder: true;
};

/**
 * Node.js stat type (compatible with UXStat)
 */
export type NodeStat = UXStat;
