import type {
    BucketSyncSetting,
    CouchDBConnection,
    EncryptionSettings,
    ObsidianLiveSyncSettings,
    P2PConnectionInfo,
} from "@lib/common/models/setting.type";

export const TYPE_IDENTICAL = "identical";
export const TYPE_INDEPENDENT = "independent";
export const TYPE_UNBALANCED = "unbalanced";
export const TYPE_CANCEL = "cancelled";

export const TYPE_BACKUP_DONE = "backup_done";
export const TYPE_BACKUP_SKIPPED = "backup_skipped";
export const TYPE_UNABLE_TO_BACKUP = "unable_to_backup";

// Intro
export const TYPE_NEW_USER = "new-user";
export const TYPE_EXISTING_USER = "existing-user";
export const TYPE_CANCELLED = "cancelled";

// Outro ask user mode
export const TYPE_EXISTING = "existing-user";
export const TYPE_NEW = "new-user";
export const TYPE_COMPATIBLE_EXISTING = "compatible-existing-user";

// OutroExistingUser
export const TYPE_APPLY = "apply";

// Select methods
export const TYPE_USE_SETUP_URI = "use-setup-uri";
export const TYPE_SCAN_QR_CODE = "scan-qr-code";
export const TYPE_CONFIGURE_MANUALLY = "configure-manually";

// ScanQRCode
export const TYPE_CLOSE = "close";

// SetupRemote
export const TYPE_COUCHDB = "couchdb";
export const TYPE_BUCKET = "bucket";
export const TYPE_P2P = "p2p";

export type ResultTypeVault =
    | typeof TYPE_IDENTICAL
    | typeof TYPE_INDEPENDENT
    | typeof TYPE_UNBALANCED
    | typeof TYPE_CANCEL;
export type ResultTypeBackup =
    | typeof TYPE_BACKUP_DONE
    | typeof TYPE_BACKUP_SKIPPED
    | typeof TYPE_UNABLE_TO_BACKUP
    | typeof TYPE_CANCEL;

export type ResultTypeExtra = {
    preventFetchingConfig: boolean;
};
export type FetchEverythingResult =
    | {
          vault: ResultTypeVault;
          backup: ResultTypeBackup;
          extra: ResultTypeExtra;
      }
    | typeof TYPE_CANCEL;

export type RebuildEverythingResult =
    | {
          backup: ResultTypeBackup;
          extra: ResultTypeExtra;
      }
    | typeof TYPE_CANCEL;

export type IntroResultType = typeof TYPE_NEW_USER | typeof TYPE_EXISTING_USER | typeof TYPE_CANCELLED;

export type OutroAskUserModeResultType =
    | typeof TYPE_EXISTING
    | typeof TYPE_NEW
    | typeof TYPE_COMPATIBLE_EXISTING
    | typeof TYPE_CANCELLED;

export type OutroExistingUserResultType = typeof TYPE_APPLY | typeof TYPE_CANCELLED;

export type OutroNewUserResultType = typeof TYPE_APPLY | typeof TYPE_CANCELLED;

export type SelectMethodNewUserResultType =
    | typeof TYPE_USE_SETUP_URI
    | typeof TYPE_CONFIGURE_MANUALLY
    | typeof TYPE_CANCELLED;

export type SelectMethodExistingResultType =
    | typeof TYPE_USE_SETUP_URI
    | typeof TYPE_SCAN_QR_CODE
    | typeof TYPE_CONFIGURE_MANUALLY
    | typeof TYPE_CANCELLED;

export type SetupRemoteResultType = typeof TYPE_COUCHDB | typeof TYPE_BUCKET | typeof TYPE_P2P | typeof TYPE_CANCELLED;

export type UseSetupURIResultType = typeof TYPE_CANCELLED | ObsidianLiveSyncSettings;

export type SetupRemoteE2EEResultType = typeof TYPE_CANCELLED | EncryptionSettings;

export type SetupRemoteBucketResultType = typeof TYPE_CANCELLED | BucketSyncSetting;

export type SetupRemoteCouchDBResultType = typeof TYPE_CANCELLED | CouchDBConnection;

export type SetupRemoteP2PResultType = typeof TYPE_CANCELLED | P2PConnectionInfo;

export type ScanQRCodeResultType = typeof TYPE_CLOSE;
