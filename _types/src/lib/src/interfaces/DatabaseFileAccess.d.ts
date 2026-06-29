// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePathWithPrefix, LoadedEntry, MetaEntry, UXFileInfo, UXFileInfoStub } from "@lib/common/types";
export interface DatabaseFileAccess {
    delete: (file: UXFileInfoStub | FilePathWithPrefix, rev?: string) => Promise<boolean>;
    store: (file: UXFileInfo, force?: boolean, skipCheck?: boolean) => Promise<boolean>;
    storeAsConflictedRevision: (file: UXFileInfo, currentRev: string, skipCheck?: boolean) => Promise<boolean>;
    storeContent(path: FilePathWithPrefix, content: string): Promise<boolean>;
    createChunks: (file: UXFileInfo, force?: boolean, skipCheck?: boolean) => Promise<boolean>;
    hasContentInRevisionHistory: (file: UXFileInfoStub | FilePathWithPrefix, content: string | string[] | Blob | ArrayBuffer, currentRev?: string) => Promise<boolean>;
    fetch: (file: UXFileInfoStub | FilePathWithPrefix, rev?: string, waitForReady?: boolean, skipCheck?: boolean) => Promise<UXFileInfo | false>;
    fetchEntryFromMeta: (meta: MetaEntry, waitForReady?: boolean, skipCheck?: boolean) => Promise<LoadedEntry | false>;
    fetchEntryMeta: (file: UXFileInfoStub | FilePathWithPrefix, rev?: string, skipCheck?: boolean) => Promise<MetaEntry | false>;
    fetchEntry: (file: UXFileInfoStub | FilePathWithPrefix, rev?: string, waitForReady?: boolean, skipCheck?: boolean) => Promise<LoadedEntry | false>;
    getConflictedRevs: (file: UXFileInfoStub | FilePathWithPrefix) => Promise<string[]>;
}
