import { ConflictService } from "@lib/services/base/ConflictService";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
export declare class InjectableConflictService<T extends ServiceContext> extends ConflictService<T> {
    queueCheckForIfOpen: import("@lib/services/lib/HandlerUtils").HandlerFunction<(path: import("../../../common/settingConstants").FilePathWithPrefix) => Promise<void>, any>;
    queueCheckFor: import("@lib/services/lib/HandlerUtils").HandlerFunction<(path: import("../../../common/settingConstants").FilePathWithPrefix) => Promise<void>, any>;
    ensureAllProcessed: import("@lib/services/lib/HandlerUtils").HandlerFunction<() => Promise<boolean>, any>;
    resolveByDeletingRevision: import("@lib/services/lib/HandlerUtils").HandlerFunction<(path: import("../../../common/settingConstants").FilePathWithPrefix, deleteRevision: string, title: string) => Promise<typeof import("../../../common/types").MISSING_OR_ERROR | typeof import("../../../common/types").AUTO_MERGED>, any>;
    resolve: import("@lib/services/lib/HandlerUtils").HandlerFunction<(filename: import("../../../common/settingConstants").FilePathWithPrefix) => Promise<void>, any>;
    resolveByNewest: import("@lib/services/lib/HandlerUtils").HandlerFunction<(filename: import("../../../common/settingConstants").FilePathWithPrefix) => Promise<boolean>, any>;
    resolveAllConflictedFilesByNewerOnes: import("@lib/services/lib/HandlerUtils").HandlerFunction<() => Promise<void>, any>;
}
