// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ServiceContext } from "@lib/services/base/ServiceBase";
import { VaultService } from "@lib/services/base/VaultService";
export declare abstract class InjectableVaultService<T extends ServiceContext> extends VaultService<T> {
}
export declare class InjectableVaultServiceCompat<T extends ServiceContext> extends InjectableVaultService<T> {
    isStorageInsensitive: import("@lib/services/lib/HandlerUtils").HandlerFunction<() => boolean, unknown>;
    getActiveFilePath: import("@lib/services/lib/HandlerUtils").HandlerFunction<() => import("../../../common/types").FilePath | undefined, unknown>;
    isValidPath(path: string): boolean;
}
