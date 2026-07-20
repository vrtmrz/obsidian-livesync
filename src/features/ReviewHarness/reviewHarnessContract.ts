import type { ObsidianLiveSyncSettings, SettingsMigrationState } from "@vrtmrz/livesync-commonlib/settings";
import type { CompatibilityPause } from "@/common/databaseCompatibility.ts";
import type {
    ReviewHarnessScenarioResult,
    ReviewHarnessScenarioStatus,
} from "./reviewHarnessTypes";

export type { ReviewHarnessScenarioResult, ReviewHarnessScenarioStatus } from "./reviewHarnessTypes";

export const REVIEW_HARNESS_SCENARIOS = [
    {
        id: "settings-lifecycle",
        title: "Settings lifecycle",
        description:
            "Checks whether loaded settings expose the seven synchronisation choices and apply new-Vault recommendations only to a genuinely new Vault.",
        mode: "automatic",
        access: "read-only",
    },
    {
        id: "compatibility-review",
        title: "Compatibility review boundary",
        description:
            "Checks the current device-local compatibility pause, then guides the reviewer through its explicit review and restart boundary.",
        mode: "guided",
        access: "device-local-state",
    },
    {
        id: "p2p-composition",
        title: "P2P composition",
        description:
            "Checks that the Obsidian host and P2P interface still resolve the current Commonlib replicator.",
        mode: "automatic",
        access: "read-only",
    },
    {
        id: "vault-round-trip",
        title: "Vault fixture round trip",
        description:
            "Creates, reads, modifies, renames, and removes a fixed owned fixture tree after explicit confirmation.",
        mode: "automatic",
        access: "dedicated-vault-fixtures",
    },
] as const;

export const REVIEW_HARNESS_SCENARIO_IDS = REVIEW_HARNESS_SCENARIOS.map(({ id }) => id);

export type ReviewHarnessScenario = (typeof REVIEW_HARNESS_SCENARIOS)[number];
export type ReviewHarnessScenarioId = ReviewHarnessScenario["id"];
export type ReviewHarnessScenarioMode = ReviewHarnessScenario["mode"];
export type ReviewHarnessScenarioAccess = ReviewHarnessScenario["access"];

export const REVIEW_HARNESS_STATE_KEY = "review-harness-v1";

export interface PendingReviewRun {
    readonly formatVersion: 1;
    readonly requestId: string;
    readonly scenarioId: "compatibility-review";
    readonly stage: "awaiting-restart";
    readonly requestedAt: string;
}

export type ParsedPendingReviewRun = { pendingRun?: PendingReviewRun; error?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export function parsePendingReviewRun(serialised: string | null | undefined): ParsedPendingReviewRun {
    if (!serialised) return {};
    let value: unknown;
    try {
        value = JSON.parse(serialised) as unknown;
    } catch {
        return { error: "Review Harness continuation is not valid JSON" };
    }
    if (!isRecord(value)) return { error: "Review Harness continuation must be an object" };
    if (value.formatVersion !== 1) {
        return { error: `Unsupported Review Harness continuation version: ${String(value.formatVersion)}` };
    }
    if (value.scenarioId !== "compatibility-review") {
        return { error: `Unknown Review Harness scenario: ${String(value.scenarioId)}` };
    }
    if (value.stage !== "awaiting-restart") {
        return { error: `Unknown Review Harness continuation stage: ${String(value.stage)}` };
    }
    if (typeof value.requestedAt !== "string") {
        return { error: "Review Harness request time must be an ISO date" };
    }
    const requestedAtMs = Date.parse(value.requestedAt);
    if (Number.isNaN(requestedAtMs) || new Date(requestedAtMs).toISOString() !== value.requestedAt) {
        return { error: "Review Harness request time must be an ISO date" };
    }
    if (value.requestId !== `compatibility-review-${value.requestedAt}`) {
        return { error: "Review Harness request ID does not match the fixed continuation format" };
    }
    return {
        pendingRun: {
            formatVersion: 1,
            requestId: value.requestId,
            scenarioId: value.scenarioId,
            stage: value.stage,
            requestedAt: value.requestedAt,
        },
    };
}

const PRESERVED_SYNC_SETTING_KEYS = [
    "liveSync",
    "syncOnSave",
    "syncOnEditorSave",
    "syncOnStart",
    "syncOnFileOpen",
    "syncAfterMerge",
    "periodicReplication",
] as const;

const NEW_VAULT_RECOMMENDATION_KEYS = [
    "syncMaxSizeInMB",
    "chunkSplitterVersion",
    "doNotUseFixedRevisionForChunks",
    "usePluginSyncV2",
    "handleFilenameCaseSensitive",
    "E2EEAlgorithm",
] as const;

type LifecycleSettingKey = (typeof PRESERVED_SYNC_SETTING_KEYS)[number] | (typeof NEW_VAULT_RECOMMENDATION_KEYS)[number];
type SettingsForLifecycleInspection = Partial<Pick<ObsidianLiveSyncSettings, LifecycleSettingKey>>;

export function inspectSettingsLifecycle(input: {
    readonly migration: SettingsMigrationState | undefined;
    readonly settings: SettingsForLifecycleInspection;
    readonly newVaultSettings: SettingsForLifecycleInspection;
}): ReviewHarnessScenarioResult {
    if (!input.migration) {
        return {
            status: "failed",
            detail: "The settings service did not expose migration evidence.",
            observations: [],
        };
    }

    const invalidSyncSettings = PRESERVED_SYNC_SETTING_KEYS.filter(
        (key) => typeof input.settings[key] !== "boolean"
    );
    if (invalidSyncSettings.length > 0) {
        return {
            status: "failed",
            detail: `Synchronisation choices are missing or invalid: ${invalidSyncSettings.join(", ")}`,
            observations: [],
        };
    }

    const observations = PRESERVED_SYNC_SETTING_KEYS.map((key) => `${key}=${String(input.settings[key])}`);
    if (!input.migration.isNewVault) {
        return {
            status: "passed",
            detail: `Loaded an existing Vault from settings schema ${input.migration.sourceVersion} to ${input.migration.targetVersion}.`,
            observations,
        };
    }

    const mismatchedRecommendations = NEW_VAULT_RECOMMENDATION_KEYS.filter(
        (key) => input.settings[key] !== input.newVaultSettings[key]
    );
    if (mismatchedRecommendations.length > 0) {
        return {
            status: "failed",
            detail: `The new Vault recommendations differ for: ${mismatchedRecommendations.join(", ")}`,
            observations,
        };
    }
    return {
        status: "passed",
        detail: "Loaded the current new Vault recommendations without enabling a remote connection.",
        observations,
    };
}

export function inspectCompatibilityReview(input: {
    readonly migration: SettingsMigrationState | undefined;
    readonly reviewInitialised: boolean;
    readonly pendingPause: CompatibilityPause | undefined;
}): ReviewHarnessScenarioResult {
    if (input.migration?.requiresSyncReview && !input.reviewInitialised) {
        return {
            status: "failed",
            detail: "The settings migration requires review, but the compatibility review was not initialised.",
            observations: [],
        };
    }

    const observations = [
        `migrationReviewRequired=${String(input.migration?.requiresSyncReview ?? false)}`,
        `compatibilityReviewInitialised=${String(input.reviewInitialised)}`,
        `compatibilityPausePending=${String(input.pendingPause !== undefined)}`,
    ];
    if (input.pendingPause) {
        observations.push(`reasonSources=${input.pendingPause.reasons.map(({ source }) => source).join(",")}`);
        observations.push(`reasonCount=${input.pendingPause.reasons.length}`);
        observations.push(`resumable=${String(input.pendingPause.resumable)}`);
    }
    return {
        status: "passed",
        detail: input.pendingPause
            ? "A device-local compatibility review is pending."
            : "No compatibility review is pending on this device.",
        observations,
    };
}

export interface ReviewHarnessReportScenario {
    readonly id: ReviewHarnessScenarioId;
    readonly title: string;
    readonly mode: ReviewHarnessScenarioMode;
    readonly status: ReviewHarnessScenarioStatus;
    readonly detail: string;
}

export interface ReviewHarnessReportInput {
    readonly generatedAt: string;
    readonly environment: {
        readonly pluginVersion: string;
        readonly obsidianVersion: string;
        readonly platform: string;
        readonly userAgent: string;
        readonly viewport: string;
    };
    readonly scenarios: readonly ReviewHarnessReportScenario[];
    readonly transcript: readonly {
        readonly at: string;
        readonly event: string;
        readonly detail?: string;
    }[];
}

function tableCell(value: string): string {
    return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, "<br>");
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
    const header = `| ${headers.map(tableCell).join(" | ")} |`;
    const separator = `| ${headers.map(() => "---").join(" | ")} |`;
    const body = rows.map((row) => `| ${row.map(tableCell).join(" | ")} |`);
    return [header, separator, ...body].join("\n");
}

export function formatReviewHarnessReport(input: ReviewHarnessReportInput): string {
    const environment = table(
        ["Field", "Value"],
        [
            ["Plug-in", input.environment.pluginVersion],
            ["Obsidian", input.environment.obsidianVersion],
            ["Platform", input.environment.platform],
            ["User agent", input.environment.userAgent],
            ["Viewport", input.environment.viewport],
        ]
    );
    const scenarios = table(
        ["Scenario", "Mode", "Status", "Detail"],
        input.scenarios.map(({ id, title, mode, status, detail }) => [
            `${title} (${id})`,
            mode,
            status,
            detail,
        ])
    );
    return `## Self-hosted LiveSync Review Harness report

Generated at \`${tableCell(input.generatedAt)}\`.

### Environment

${environment}

### Scenarios

${scenarios}

<details>
<summary>Event transcript</summary>

\`\`\`json
${JSON.stringify(input.transcript, null, 2)}
\`\`\`
</details>

This report was copied locally and was not transmitted by Self-hosted LiveSync. It intentionally omits Vault identifiers, paths, file names, file contents, remote configuration, and secrets. Review the environment information before posting because a user agent and viewport may identify the device or operating system.
`;
}
