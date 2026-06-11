import type { FilePath } from "@lib/common/models/db.type";
import type { UXFileInfoStub, UXInternalFileInfoStub } from "@lib/common/models/fileaccess.type";
/**
 * Adapter interface for converting platform-specific file types to UX types
 *
 * @template TFile - Platform-specific file type
 */
export interface IStorageEventConverterAdapter<TFile> {
    /**
     * Convert platform-specific file to UXFileInfoStub
     */
    toFileInfo(file: TFile, deleted?: boolean): UXFileInfoStub;
    /**
     * Convert path to UXInternalFileInfoStub
     */
    toInternalFileInfo(path: FilePath): UXInternalFileInfoStub;
}
