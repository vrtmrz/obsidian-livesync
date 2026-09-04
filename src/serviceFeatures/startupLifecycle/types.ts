import type { AnyEntry, ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import type { LiveSyncEventHub, ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import type { ObsidianNoticeGroups } from "@/modules/services/ObsidianNoticeGroups";

/** A value which may be read once or evaluated when a lifecycle handler runs. */
export type StartupLifecycleValue<T> = T | (() => T);

/** The minimum Context extension needed by the Obsidian start-up integrity check. */
export type StartupLifecycleContext = ServiceContext & {
    readonly events: LiveSyncEventHub;
    readonly noticeGroups: Pick<ObsidianNoticeGroups, "setItem" | "finish">;
};

/** Services and ServiceModules consumed by the start-up feature composer. */
export type StartupLifecycleHost = NecessaryServices<
    "API" | "UI" | "appLifecycle" | "setting" | "replicator" | "vault" | "path" | "keyValueDB" | "database",
    "storageAccess" | "fileHandler" | "rebuilder"
> & {
    services: NecessaryServices<
        "API" | "UI" | "appLifecycle" | "setting" | "replicator" | "vault" | "path" | "keyValueDB" | "database",
        "storageAccess" | "fileHandler" | "rebuilder"
    >["services"] & {
        context: StartupLifecycleContext;
    };
};

/** Focused operations which make up the configured Vault first-initialise gate. */
export interface ConfiguredStartupLifecycleOperations {
    readonly databaseReady: StartupLifecycleValue<boolean>;
    readonly reportDatabaseNotReady: () => void;
    readonly hasCompromisedChunks: () => Promise<boolean>;
    readonly hasIncompleteDocuments: (force?: boolean) => Promise<boolean>;
    readonly waitForCompatibilityReview: () => Promise<void>;
    readonly runDoctor: (skipRebuild?: boolean, activateReason?: string, forceRescan?: boolean) => Promise<boolean>;
    readonly migrateBulkSend: () => Promise<void>;
}

/** Explicit host decisions and optional operation overrides for composition. */
export interface StartupLifecycleFeatureOptions extends Partial<ConfiguredStartupLifecycleOperations> {
    /** Invites an unconfigured Vault to begin onboarding. */
    readonly inviteToOnboarding: () => void;
    /** Waits for the compatibility review before opening Config Doctor. */
    readonly waitForCompatibilityReview: () => Promise<void>;
    /** Current configured-state query; defaults to the loaded setting. */
    readonly configured?: StartupLifecycleValue<boolean>;
    /** Logger used by the default operations. */
    readonly log?: LogFunction;
}

/** Minimal mutable settings view required by the obsolete bulk-send migration. */
export type LegacyBulkSendSettings = Pick<ObsidianLiveSyncSettings, "sendChunksBulk" | "sendChunksBulkMaxSize">;

/** Keep path conversion visible at the incomplete-document operation boundary. */
export type StartupPathReader = (entry: AnyEntry) => string;
