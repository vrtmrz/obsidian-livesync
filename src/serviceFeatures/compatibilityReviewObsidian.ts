import { Notice } from "@/deps.ts";
import type { Confirm } from "@vrtmrz/livesync-commonlib/compat/interfaces/Confirm";
import type { CompatibilityPause, CompatibilityPauseReason } from "@/common/databaseCompatibility.ts";
import type {
    CompatibilityReviewDetailsAction,
    CompatibilityReviewSummaryAction,
    CompatibilityReviewUi,
} from "./compatibilityReview.ts";

const REVIEW_DETAILS = "Review compatibility details";
const KEEP_PAUSED = "Keep synchronisation paused";
const RESUME = "Resume synchronisation";
const BACK = "Back to compatibility review";

function summaryMarkdown(pause: CompatibilityPause): string {
    const action = pause.resumable
        ? "Before resuming, review the compatibility details and update Self-hosted LiveSync on every device which uses this remote database."
        : "This installation cannot safely acknowledge the detected state. Update Self-hosted LiveSync before attempting to synchronise again.";
    return `Remote synchronisation is paused on this device because its compatibility state requires attention.

${action}

Your automatic synchronisation preferences have not been changed. Closing this dialogue keeps synchronisation paused.`;
}

function reasonMarkdown(reason: CompatibilityPauseReason): string {
    if (reason.source === "database-version") {
        if (reason.state === "upgrade") {
            return `- The last acknowledged internal database version was **${reason.acknowledgedVersion}** and this installation uses **${reason.currentVersion}**.`;
        }
        if (reason.state === "downgrade") {
            return `- This installation uses internal database version **${reason.currentVersion}**, but this device previously acknowledged newer version **${reason.acknowledgedVersion}**. An older installation must not resume synchronisation.`;
        }
        if (reason.state === "missing") {
            return `- No previously acknowledged internal database version was found for this existing Vault. This installation uses version **${reason.currentVersion}**.`;
        }
        return `- The saved internal database version marker is invalid. This installation uses version **${reason.currentVersion}**.`;
    }
    if (reason.source === "settings-schema") {
        if (reason.isFromFutureSchema) {
            return `- The saved settings use schema **${reason.sourceVersion}**, which is newer than schema **${reason.currentVersion}** supported by this installation.`;
        }
        return `- The settings were migrated from schema **${reason.sourceVersion}** to **${reason.currentVersion}** and require review before synchronisation resumes.`;
    }
    const escapedMessage = reason.message.replace(/[\\`*_{}[\]()<>#+.!|-]/gu, "\\$&");
    return `- An earlier compatibility review remains pending: ${escapedMessage}`;
}

function detailsMarkdown(pause: CompatibilityPause): string {
    const resolution = pause.resumable
        ? "After all devices have been updated, return to the compatibility review summary and explicitly resume synchronisation. The current internal version will only then be recorded as acknowledged."
        : "Install a compatible current version of Self-hosted LiveSync. This pause cannot be dismissed by the current installation.";
    return `## Why synchronisation is paused

${pause.reasons.map(reasonMarkdown).join("\n")}

## What the pause changes

- Remote replication is blocked before work begins.
- Your saved automatic synchronisation preferences remain unchanged.
- Closing either dialogue leaves the safety gate active.

## What to do next

${resolution}`;
}

export class ObsidianCompatibilityReviewUi implements CompatibilityReviewUi {
    private reminder: Notice | undefined;

    constructor(private readonly confirm: Confirm) {}

    async showSummary(pause: CompatibilityPause): Promise<CompatibilityReviewSummaryAction> {
        const buttons = pause.resumable
            ? ([REVIEW_DETAILS, RESUME, KEEP_PAUSED] as const)
            : ([REVIEW_DETAILS, KEEP_PAUSED] as const);
        const result = await this.confirm.confirmWithMessage(
            "Synchronisation paused for compatibility review",
            summaryMarkdown(pause),
            [...buttons],
            KEEP_PAUSED,
            undefined,
            "vertical"
        );
        if (result === REVIEW_DETAILS) return "details";
        if (result === RESUME) return "resume";
        if (result === KEEP_PAUSED) return "keep-paused";
        return false;
    }

    async showDetails(pause: CompatibilityPause): Promise<CompatibilityReviewDetailsAction> {
        const result = await this.confirm.confirmWithMessage(
            "Compatibility review details",
            detailsMarkdown(pause),
            [BACK],
            BACK,
            undefined,
            "vertical"
        );
        if (result === BACK) return "back";
        return false;
    }

    showReminder(openReview: () => void): void {
        this.clearReminder();
        let reminderAnchor: HTMLAnchorElement | undefined;
        const fragment = createFragment((documentFragment) => {
            documentFragment.createSpan({
                text: "Self-hosted LiveSync has paused remote synchronisation for compatibility review. ",
            });
            documentFragment.createEl("a", { text: "Review why" }, (anchor) => {
                reminderAnchor = anchor;
                anchor.addEventListener("click", (event) => {
                    event.preventDefault();
                    openReview();
                });
            });
        });
        this.reminder = new Notice(fragment, 0);
        reminderAnchor?.closest<HTMLElement>(".notice")?.classList.add("livesync-compatibility-review-notice");
    }

    clearReminder(): void {
        this.reminder?.hide();
        this.reminder = undefined;
    }
}

export function createObsidianCompatibilityReviewUi(confirm: Confirm): CompatibilityReviewUi {
    return new ObsidianCompatibilityReviewUi(confirm);
}
