import { join, resolve } from "node:path";

export const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
export const CLI_DIR = join(REPOSITORY_ROOT, "src", "apps", "cli");
export const CLI_DIST = join(CLI_DIR, "dist", "index.cjs");
