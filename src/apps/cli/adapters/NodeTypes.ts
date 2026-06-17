import type { FilePath, UXStat } from "@lib/common/types";

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
