// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { DocumentID, EntryHasPath, FilePathWithPrefix, FilePath, AnyEntry, UXFileInfo, UXFileInfoStub } from "@lib/common/types";
import type { IPathService, ISettingService } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
import type { BASE_IS_NEW, EVEN, TARGET_IS_NEW } from "@lib/common/models/shared.const.symbols";
export interface PathServiceDependencies {
    settingService: ISettingService;
}
/**
 * The PathService provides methods for converting between file paths and document IDs.
 * This class would be migrated to the new logic later.
 */
export declare abstract class PathService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IPathService {
    protected settingService: ISettingService;
    protected abstract normalizePath(path: string): string;
    get settings(): import("@lib/common/types").ObsidianLiveSyncSettings;
    constructor(context: T, dependencies: PathServiceDependencies);
    private _id2path;
    private _path2id;
    /**
     * Convert a document ID or entry to a virtual file path.
     * @param id A document ID. Nowadays, it is mostly not the same as the file path.
     * If the document has `_` prefixed, saved as `/_`.
     * @param entry An entry object. If provided, it can be used to get the path directly.
     * @param stripPrefix Whether to strip the prefix from the path.
     */
    id2path(id: DocumentID, entry?: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix;
    /**
     * Convert a virtual file path to a document ID (with prefix if any).
     * @param filename A file path with or without prefix.
     * @param prefix The prefix to use for the document ID.
     */
    path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID>;
    getPath(entry: AnyEntry): FilePathWithPrefix;
    abstract markChangesAreSame(old: UXFileInfo | AnyEntry | FilePathWithPrefix, newMtime: number, oldMtime: number): boolean | undefined;
    abstract unmarkChanges(file: AnyEntry | FilePathWithPrefix | UXFileInfoStub): void;
    abstract compareFileFreshness(baseFile: UXFileInfoStub | AnyEntry | undefined, checkTarget: UXFileInfo | AnyEntry | undefined): typeof BASE_IS_NEW | typeof TARGET_IS_NEW | typeof EVEN;
    abstract isMarkedAsSameChanges(file: UXFileInfoStub | AnyEntry | FilePathWithPrefix, mtimes: number[]): undefined | typeof EVEN;
}
