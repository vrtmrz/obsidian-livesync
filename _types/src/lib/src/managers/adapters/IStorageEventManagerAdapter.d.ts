// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { IStorageEventTypeGuardAdapter } from "./IStorageEventTypeGuardAdapter";
import type { IStorageEventPersistenceAdapter } from "./IStorageEventPersistenceAdapter";
import type { IStorageEventWatchAdapter } from "./IStorageEventWatchAdapter";
import type { IStorageEventStatusAdapter } from "./IStorageEventStatusAdapter";
import type { IStorageEventConverterAdapter } from "./IStorageEventConverterAdapter";
/**
 * Composite adapter interface for StorageEventManager
 *
 * @template TFile - Platform-specific file type
 * @template TFolder - Platform-specific folder type
 */
export interface IStorageEventManagerAdapter<TFile, TFolder> {
    readonly typeGuard: IStorageEventTypeGuardAdapter<TFile, TFolder>;
    readonly persistence: IStorageEventPersistenceAdapter;
    readonly watch: IStorageEventWatchAdapter<TFile, unknown>;
    readonly status: IStorageEventStatusAdapter;
    readonly converter: IStorageEventConverterAdapter<TFile>;
}
