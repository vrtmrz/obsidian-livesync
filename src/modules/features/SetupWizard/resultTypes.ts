import type {
    BucketSyncSetting,
    CouchDBConnection,
    EncryptionSettings,
    ObsidianLiveSyncSettings,
    P2PConnectionInfo,
    P2PSyncSetting,
} from "@/lib/src/common/types";

export type CancelledResult = "cancelled";

export type IntroResult = "new-user" | "existing-user" | CancelledResult;
export type SelectMethodNewUserResult = "use-setup-uri" | "configure-manually" | CancelledResult;
export type SelectMethodExistingResult = "use-setup-uri" | "scan-qr-code" | "configure-manually" | CancelledResult;
export type SetupRemoteResult = "couchdb" | "bucket" | "p2p" | CancelledResult;
export type OutroAskUserModeResult = "new-user" | "existing-user" | "compatible-existing-user" | CancelledResult;
export type OutroResult = "apply" | CancelledResult;
export type UseSetupURIResult = CancelledResult | ObsidianLiveSyncSettings;
export type SetupRemoteCouchDBResult = CancelledResult | CouchDBConnection;
export type SetupRemoteBucketResult = CancelledResult | BucketSyncSetting;
export type SetupRemoteP2PResult = CancelledResult | P2PConnectionInfo;
export type SetupRemoteE2EEResult = CancelledResult | EncryptionSettings;
export type SetupRemoteCouchDBInitialData = CouchDBConnection;
export type SetupRemoteBucketInitialData = BucketSyncSetting;
export type SetupRemoteP2PInitialData = P2PSyncSetting;
export type SetupRemoteE2EEInitialData = EncryptionSettings;

export type FetchEverythingVaultResult = "identical" | "independent" | "unbalanced" | "cancelled";
export type BackupDecisionResult = "backup_done" | "backup_skipped" | "unable_to_backup" | "cancelled";
export type FetchEverythingExtraResult = { preventFetchingConfig: boolean };

export type FetchEverythingResult =
    | CancelledResult
    | {
          vault: FetchEverythingVaultResult;
          backup: BackupDecisionResult;
          extra: FetchEverythingExtraResult;
      };

export type RebuildEverythingResult =
    | CancelledResult
    | {
          backup: BackupDecisionResult;
          extra: FetchEverythingExtraResult;
      };
