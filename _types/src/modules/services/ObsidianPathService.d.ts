// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";
import { PathService } from "@lib/services/base/PathService";
import { type BASE_IS_NEW, type TARGET_IS_NEW, type EVEN } from "@/common/utils";
import type { UXFileInfo, AnyEntry, UXFileInfoStub, FilePathWithPrefix } from "@lib/common/types";
export declare class ObsidianPathService extends PathService<ObsidianServiceContext> {
    markChangesAreSame(old: UXFileInfo | AnyEntry | FilePathWithPrefix, newMtime: number, oldMtime: number): boolean | undefined;
    unmarkChanges(file: AnyEntry | FilePathWithPrefix | UXFileInfoStub): void;
    compareFileFreshness(baseFile: UXFileInfoStub | AnyEntry | undefined, checkTarget: UXFileInfo | AnyEntry | undefined): typeof BASE_IS_NEW | typeof TARGET_IS_NEW | typeof EVEN;
    isMarkedAsSameChanges(file: UXFileInfoStub | AnyEntry | FilePathWithPrefix, mtimes: number[]): undefined | typeof EVEN;
    protected normalizePath(path: string): string;
}
