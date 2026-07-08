// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { AbstractModule } from "@/modules/AbstractModule";
import { type EntryDoc, type RemoteType } from "@lib/common/types";
import type { LiveSyncCore } from "@/main";
import { ReplicateResultProcessor } from "./ReplicateResultProcessor";
export declare class ModuleReplicator extends AbstractModule {
    _replicatorType?: RemoteType;
    processor: ReplicateResultProcessor;
    private _unresolvedErrorManager;
    clearErrors(): void;
    private _everyOnloadAfterLoadSettings;
    _onReplicatorInitialised(): Promise<boolean>;
    _everyOnDatabaseInitialized(showNotice: boolean): Promise<boolean>;
    _everyBeforeReplicate(showMessage: boolean): Promise<boolean>;
    /**
     * obsolete method. No longer maintained and will be removed in the future.
     * @deprecated v0.24.17
     * @param showMessage If true, show message to the user.
     */
    cleaned(showMessage: boolean): Promise<void>;
    private onReplicationFailed;
    _parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): Promise<boolean>;
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void;
}
