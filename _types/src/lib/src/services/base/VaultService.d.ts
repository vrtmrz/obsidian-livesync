// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePath } from "@lib/common/types";
import type { IAPIService, ISettingService, IVaultService } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
export interface VaultServiceDependencies {
    settingService: ISettingService;
    APIService: IAPIService;
}
/**
 * The VaultService provides methods for interacting with the vault (local file system).
 */
export declare abstract class VaultService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IVaultService {
    protected settingService: ISettingService;
    protected APIService: IAPIService;
    get settings(): import("@lib/common/types").ObsidianLiveSyncSettings;
    constructor(context: T, dependencies: VaultServiceDependencies);
    /**
     * Get the vault name only.
     */
    vaultName(): string;
    /**
     * Get the vault name with additional suffixes.
     */
    getVaultName(): string;
    /**
     * Scan the vault for changes (especially for changes during the plug-in were not running).
     * @param showingNotice Whether to show a notice to the user.
     * @param ignoreSuspending Whether to ignore any suspending state.
     */
    readonly scanVault: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(showingNotice?: boolean, ignoreSuspending?: boolean) => Promise<boolean>>;
    /**
     * Check if a file is ignored by the ignore file (e.g., .gitignore, .obsidianignore).
     * @param file The file path or file info stub to check.
     */
    readonly isIgnoredByIgnoreFile: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(file: string | import("@lib/common/types").UXFileInfoStub) => Promise<boolean>>;
    /**
     * Check if a file is a target file for synchronisation.
     * @param file The file path or file info stub to check.
     * @param keepFileCheckList Whether to keep the file in the check list.
     */
    readonly isTargetFile: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(file: string | import("@lib/common/types").UXFileInfoStub) => Promise<boolean>>;
    /**
     * Check if a file is a target file for some extra feature
     */
    readonly isTargetFileInExtra: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(file: string | import("@lib/common/types").UXFileInfoStub) => Promise<boolean>>;
    /**
     * Check if a filesize is too large against the current settings.
     * @param size The file size to check.
     */
    isFileSizeTooLarge(size: number): boolean;
    /**
     * Get the currently active file path in the editor, if any.
     */
    abstract getActiveFilePath(): FilePath | undefined;
    /**
     * Check if the vault is on a case-insensitive file system.
     * This is important for certain operating systems like Windows and macOS.
     */
    abstract isStorageInsensitive(): boolean;
    /**
     * Check if the file system should be treated case-insensitively.
     * This is important for certain operating systems like Windows and macOS.
     */
    shouldCheckCaseInsensitively(): boolean;
    /**
     * Check if a given path is valid in the vault.
     * @param path The file path to check.
     */
    abstract isValidPath(path: string): boolean;
}
