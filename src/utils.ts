import { normalizePath } from "obsidian";

import { path2id_base, id2path_base } from "./lib/src/utils";

// For backward compatibility, using the path for determining id.
// Only CouchDB nonacceptable ID (that starts with an underscore) has been prefixed with "/".
// The first slash will be deleted when the path is normalized.
export function path2id(filename: string): string {
    const x = normalizePath(filename);
    return path2id_base(x);
}
export function id2path(filename: string): string {
    return id2path_base(normalizePath(filename));
}
