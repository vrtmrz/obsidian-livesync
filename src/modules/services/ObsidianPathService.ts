import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";
import { normalizePath } from "@/deps";
import { PathService } from "@/lib/src/services/base/PathService";
export class ObsidianPathService extends PathService<ObsidianServiceContext> {
    protected normalizePath(path: string): string {
        return normalizePath(path);
    }
}
