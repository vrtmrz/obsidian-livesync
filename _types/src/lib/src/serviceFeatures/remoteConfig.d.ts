// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type LOG_LEVEL } from "@lib/common/logger";
import type { ObsidianLiveSyncSettings } from "@lib/common/models/setting.type";
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
export type RemoteConfigHost = NecessaryServices<"setting" | "UI" | "replication" | "control" | "appLifecycle" | "API", never>;
export declare function migrateLegacyRemoteConfigurationsInPlace(settings: ObsidianLiveSyncSettings, log?: (message: string, level?: LOG_LEVEL) => void): boolean;
/**
 * Generate a unique ID for a new remote configuration.
 * @returns A unique string identifier.
 */
export declare function createRemoteConfigurationId(): string;
/**
 * Keep compatibility for users who were already using P2P as their main active remote.
 */
export declare function migrateP2PActiveRemoteConfigurationIdInPlace(settings: ObsidianLiveSyncSettings): boolean;
/**
 * SF:RemoteConfig - Service Feature for Remote Configuration Management
 */
/**
 * Migrates existing flat settings to the new multiple remote configurations list.
 */
export declare function migrateToMultipleRemoteConfigurations(host: RemoteConfigHost): Promise<boolean>;
/**
 * Logic to switch the active configuration.
 */
export declare function activateRemoteConfiguration(settings: ObsidianLiveSyncSettings, id: string): ObsidianLiveSyncSettings | false;
/**
 * Apply a dedicated P2P remote configuration onto runtime P2P-related fields,
 * while keeping the current `remoteType` unchanged.
 */
export declare function activateP2PRemoteConfiguration(settings: ObsidianLiveSyncSettings, id: string): ObsidianLiveSyncSettings | false;
/**
 * Command: Switch Active Remote
 */
export declare function commandSwitchActiveRemote(host: RemoteConfigHost): Promise<void>;
/**
 * Command: Replicate with specific remote
 */
export declare function commandReplicateWithSpecificRemote(host: RemoteConfigHost): Promise<void>;
/**
 * Migration feature to be used during initialisation.
 */
export declare function useRemoteConfigurationMigration(host: RemoteConfigHost): void;
/**
 * Hook to set up remote configuration features (Commands).
 */
export declare function useRemoteConfiguration(host: RemoteConfigHost): boolean;
