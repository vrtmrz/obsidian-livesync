import { Notice } from "@/deps.ts";
import type { Confirm } from "@vrtmrz/livesync-commonlib/compat/interfaces/Confirm";
import {
    requiresFilenameCaseSensitivityDecision,
    type CompatibilityPause,
} from "@/common/databaseCompatibility.ts";
import type {
    CompatibilityReviewDetailsAction,
    CompatibilityReviewSummaryAction,
    CompatibilityReviewUi,
} from "./compatibilityReview.ts";
import {
    compatibilityReviewDetailsMarkdown,
    compatibilityReviewSummaryMarkdown,
} from "./compatibilityReviewMarkdown.ts";

const REVIEW_DETAILS = "Review compatibility details";
const KEEP_PAUSED = "Keep synchronisation paused";
const USE_CASE_SENSITIVE = "Keep case-sensitive handling and resume";
const RESUME = "Resume synchronisation";
const BACK = "Back to compatibility review";

export class ObsidianCompatibilityReviewUi implements CompatibilityReviewUi {
    private reminder: Notice | undefined;

    constructor(private readonly confirm: Confirm) {}

    async showSummary(pause: CompatibilityPause): Promise<CompatibilityReviewSummaryAction> {
        const buttons = !pause.resumable
            ? ([REVIEW_DETAILS, KEEP_PAUSED] as const)
            : requiresFilenameCaseSensitivityDecision(pause)
              ? ([REVIEW_DETAILS, USE_CASE_SENSITIVE, KEEP_PAUSED] as const)
              : ([REVIEW_DETAILS, RESUME, KEEP_PAUSED] as const);
        const result = await this.confirm.confirmWithMessage(
            "Synchronisation paused for compatibility review",
            compatibilityReviewSummaryMarkdown(pause),
            [...buttons],
            KEEP_PAUSED,
            undefined,
            "vertical"
        );
        if (result === REVIEW_DETAILS) return "details";
        if (result === USE_CASE_SENSITIVE) return "use-case-sensitive";
        if (result === RESUME) return "resume";
        if (result === KEEP_PAUSED) return "keep-paused";
        return false;
    }

    async showDetails(pause: CompatibilityPause): Promise<CompatibilityReviewDetailsAction> {
        const result = await this.confirm.confirmWithMessage(
            "Compatibility review details",
            compatibilityReviewDetailsMarkdown(pause),
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
