// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { type EntryDoc } from "@lib/common/types";
import { type ReplicateResultProcessor } from "./replicateResultProcessor";
import { UnresolvedErrorManager } from "@lib/services/base/UnresolvedErrorManager";
import { type LogFunction } from "@lib/services/lib/logUtils";
import type { NecessaryObsidianFeature } from "@/types";
export type ReplicatorHost = NecessaryObsidianFeature<"appLifecycle" | "replication" | "replicator" | "setting" | "tweakValue" | "API" | "database" | "databaseEvents" | "keyValueDB" | "path" | "vault" | "UI", "databaseFileAccess" | "rebuilder">;
export declare const everyOnloadAfterLoadSettingsHandler: (host: ReplicatorHost, processor: ReplicateResultProcessor) => Promise<boolean>;
export declare const onReplicatorInitialisedHandler: () => Promise<boolean>;
export declare const everyOnDatabaseInitializedHandler: (processor: ReplicateResultProcessor, showNotice: boolean) => Promise<boolean>;
export declare const everyBeforeReplicateHandler: (unresolvedErrorManager: UnresolvedErrorManager, processor: ReplicateResultProcessor, showMessage: boolean) => Promise<boolean>;
export declare const cleanedHandler: (host: ReplicatorHost, showMessage: boolean, log?: LogFunction) => Promise<void>;
export declare const onReplicationFailedHandler: (host: ReplicatorHost, showMessage?: boolean, log?: LogFunction) => Promise<boolean>;
export declare const parseReplicationResultHandler: (processor: ReplicateResultProcessor, docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>) => Promise<boolean>;
export declare function useReplicator(host: ReplicatorHost): void;
