import type { SettingsMigrationState } from "@vrtmrz/livesync-commonlib/compat/common/types";

export const DATABASE_COMPATIBILITY_VERSION_KEY = "database-compatibility-version";
export const DATABASE_COMPATIBILITY_LEGACY_VERSION_KEY_PREFIX = "obsidian-live-sync-ver";
export const COMPATIBILITY_PAUSE_SETTING_MESSAGE =
    "Remote synchronisation is paused until this device's compatibility review has been completed.";

export type DatabaseCompatibilityVersionState = "missing" | "invalid" | "upgrade" | "downgrade";

export interface DatabaseCompatibilityReason {
    source: "database-version";
    state: DatabaseCompatibilityVersionState;
    acknowledgedVersion?: number;
    currentVersion: number;
    resumable: boolean;
}

export interface SettingsCompatibilityReason {
    source: "settings-schema";
    sourceVersion: number;
    currentVersion: number;
    isFromFutureSchema: boolean;
    resumable: boolean;
}

export interface LegacyCompatibilityReason {
    source: "legacy-review";
    message: string;
    resumable: true;
}

export type CompatibilityPauseReason =
    | DatabaseCompatibilityReason
    | SettingsCompatibilityReason
    | LegacyCompatibilityReason;

export interface CompatibilityPause {
    reasons: readonly CompatibilityPauseReason[];
    resumable: boolean;
}

export interface CompatibilityEvaluation {
    pause?: CompatibilityPause;
    initialiseAcknowledgedVersion: boolean;
}

export interface CompatibilityEvaluationInput {
    acknowledgedVersion: string | null;
    currentVersion: number;
    migrationState?: SettingsMigrationState;
    legacyReviewMessage: string;
}

function databaseVersionReason(
    acknowledgedVersion: string | null,
    currentVersion: number,
    isNewVault: boolean
): DatabaseCompatibilityReason | undefined {
    if (acknowledgedVersion === null || acknowledgedVersion === "") {
        if (isNewVault) return undefined;
        return {
            source: "database-version",
            state: "missing",
            currentVersion,
            resumable: true,
        };
    }

    const parsed = Number(acknowledgedVersion);
    if (!Number.isSafeInteger(parsed)) {
        return {
            source: "database-version",
            state: "invalid",
            currentVersion,
            resumable: true,
        };
    }
    if (parsed === currentVersion) return undefined;
    if (parsed < currentVersion) {
        return {
            source: "database-version",
            state: "upgrade",
            acknowledgedVersion: parsed,
            currentVersion,
            resumable: true,
        };
    }
    return {
        source: "database-version",
        state: "downgrade",
        acknowledgedVersion: parsed,
        currentVersion,
        resumable: false,
    };
}

/**
 * Derives a host-neutral compatibility pause from device-local and settings-schema state.
 *
 * The caller owns persistence, user interaction, and the actual replication gate.
 */
export function evaluateCompatibilityPause(input: CompatibilityEvaluationInput): CompatibilityEvaluation {
    const isNewVault = input.migrationState?.isNewVault === true;
    const reasons: CompatibilityPauseReason[] = [];
    const databaseReason = databaseVersionReason(input.acknowledgedVersion, input.currentVersion, isNewVault);
    if (databaseReason) reasons.push(databaseReason);

    if (input.migrationState?.requiresSyncReview === true) {
        reasons.push({
            source: "settings-schema",
            sourceVersion: input.migrationState.sourceVersion,
            currentVersion: input.migrationState.targetVersion,
            isFromFutureSchema: input.migrationState.isFromFutureSchema,
            resumable: !input.migrationState.isFromFutureSchema,
        });
    }

    if (input.legacyReviewMessage !== "" && reasons.length === 0) {
        reasons.push({
            source: "legacy-review",
            message: input.legacyReviewMessage,
            resumable: true,
        });
    }

    if (reasons.length === 0) {
        return {
            initialiseAcknowledgedVersion:
                isNewVault && (input.acknowledgedVersion === null || input.acknowledgedVersion === ""),
        };
    }

    return {
        pause: {
            reasons,
            resumable: reasons.every((reason) => reason.resumable),
        },
        initialiseAcknowledgedVersion: false,
    };
}

export function legacyDatabaseCompatibilityVersionKey(vaultName: string): string {
    return `${DATABASE_COMPATIBILITY_LEGACY_VERSION_KEY_PREFIX}${vaultName}`;
}
