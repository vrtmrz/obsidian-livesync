// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { UXFileInfo, AnyEntry, UXFileInfoStub, FilePathWithPrefix } from "@lib/common/types";
import { PathService } from "@lib/services/base/PathService";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
import { BASE_IS_NEW, EVEN, TARGET_IS_NEW } from "@lib/common/models/shared.const.symbols";
export declare function compareFileFreshnessGeneric(baseFile: UXFileInfoStub | AnyEntry | undefined, checkTarget: UXFileInfo | AnyEntry | undefined): typeof BASE_IS_NEW | typeof TARGET_IS_NEW | typeof EVEN;
export declare class PathServiceCompat<T extends ServiceContext> extends PathService<T> {
    markChangesAreSame(old: UXFileInfo | AnyEntry | FilePathWithPrefix, newMtime: number, oldMtime: number): boolean | undefined;
    unmarkChanges(file: AnyEntry | FilePathWithPrefix | UXFileInfoStub): void;
    compareFileFreshness(baseFile: UXFileInfoStub | AnyEntry | undefined, checkTarget: UXFileInfo | AnyEntry | undefined): typeof BASE_IS_NEW | typeof TARGET_IS_NEW | typeof EVEN;
    isMarkedAsSameChanges(file: UXFileInfoStub | AnyEntry | FilePathWithPrefix, mtimes: number[]): undefined | typeof EVEN;
    normalizePath(path: string): string;
}
