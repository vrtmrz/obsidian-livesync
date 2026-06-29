// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { ConflictService } from "@lib/services/base/ConflictService";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
export declare class InjectableConflictService<T extends ServiceContext> extends ConflictService<T> {
    queueCheckForIfOpen: import("@lib/services/lib/HandlerUtils").HandlerFunction<(path: import("../../../common/types").FilePathWithPrefix) => Promise<void>, unknown>;
    queueCheckFor: import("@lib/services/lib/HandlerUtils").HandlerFunction<(path: import("../../../common/types").FilePathWithPrefix) => Promise<void>, unknown>;
    ensureAllProcessed: import("@lib/services/lib/HandlerUtils").HandlerFunction<() => Promise<boolean>, unknown>;
    resolveByDeletingRevision: import("@lib/services/lib/HandlerUtils").HandlerFunction<(path: import("../../../common/types").FilePathWithPrefix, deleteRevision: string, title: string) => Promise<typeof import("../../../common/types").MISSING_OR_ERROR | typeof import("../../../common/types").AUTO_MERGED>, unknown>;
    resolve: import("@lib/services/lib/HandlerUtils").HandlerFunction<(filename: import("../../../common/types").FilePathWithPrefix) => Promise<void>, unknown>;
    resolveByNewest: import("@lib/services/lib/HandlerUtils").HandlerFunction<(filename: import("../../../common/types").FilePathWithPrefix) => Promise<boolean>, unknown>;
    resolveAllConflictedFilesByNewerOnes: import("@lib/services/lib/HandlerUtils").HandlerFunction<() => Promise<void>, unknown>;
}
