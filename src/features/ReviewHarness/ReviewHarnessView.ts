import { ItemView, Notice, Setting, type WorkspaceLeaf } from "@/deps";
import {
    REVIEW_HARNESS_SCENARIOS,
    type ReviewHarnessScenarioId,
    type ReviewHarnessScenarioStatus,
} from "./reviewHarnessContract";
import type { ReviewHarnessController } from "./reviewHarnessController";

export const VIEW_TYPE_REVIEW_HARNESS = "self-hosted-livesync-review-harness";

const STATUS_LABELS: Record<ReviewHarnessScenarioStatus, string> = {
    idle: "Not run",
    queued: "Queued",
    running: "Running",
    "waiting-for-user": "Waiting for review",
    passed: "Passed",
    failed: "Failed",
    cancelled: "Cancelled",
};

export class ReviewHarnessView extends ItemView {
    override icon = "test-tube-2";
    override navigation = true;
    private unsubscribe: (() => void) | undefined;

    constructor(
        leaf: WorkspaceLeaf,
        private readonly controller: ReviewHarnessController
    ) {
        super(leaf);
    }

    getViewType(): string {
        return VIEW_TYPE_REVIEW_HARNESS;
    }

    getDisplayText(): string {
        return "Self-hosted LiveSync review harness";
    }

    override async onOpen(): Promise<void> {
        this.unsubscribe = this.controller.subscribe(() => this.render());
        this.render();
        await Promise.resolve();
    }

    override async onClose(): Promise<void> {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        await Promise.resolve();
    }

    private addActionButton(
        setting: Setting,
        label: string,
        testId: string,
        action: () => void | Promise<void>,
        cta = false
    ): void {
        setting.addButton((button) => {
            button.setButtonText(label);
            if (cta) button.setCta();
            button.buttonEl.dataset.testid = testId;
            button.onClick(() => void action());
        });
    }

    private renderScenario(id: ReviewHarnessScenarioId): void {
        const scenario = REVIEW_HARNESS_SCENARIOS.find((candidate) => candidate.id === id)!;
        const snapshot = this.controller.snapshot();
        const result = snapshot.results[id];
        const setting = new Setting(this.contentEl)
            .setName(scenario.title)
            .setDesc(`${scenario.description} Mode: ${scenario.mode}. Access: ${scenario.access}.`)
            .setClass("sls-review-harness__scenario");
        setting.settingEl.dataset.testid = `review-harness-scenario-${id}`;

        this.addActionButton(
            setting,
            id === "compatibility-review" ? "Start review" : "Run",
            `review-harness-run-${id}`,
            () => this.controller.runScenario(id)
        );

        const resultEl = this.contentEl.createDiv({ cls: "sls-review-harness__result" });
        resultEl.dataset.testid = `review-harness-result-${id}`;
        resultEl.createEl("strong", { text: `${STATUS_LABELS[result.status]}: ` });
        resultEl.appendText(result.detail);
        if (result.observations.length > 0) {
            const observations = resultEl.createEl("ul");
            for (const observation of result.observations) observations.createEl("li", { text: observation });
        }

        if (id === "compatibility-review" && result.status === "waiting-for-user") {
            const actions = new Setting(this.contentEl).setClass("sls-review-harness__actions");
            this.addActionButton(
                actions,
                "Open compatibility review",
                "review-harness-open-compatibility-review",
                () => this.controller.openCompatibilityReview(),
                true
            );
            this.addActionButton(actions, "Restart and return", "review-harness-restart", () =>
                this.controller.prepareCompatibilityReviewRestart()
            );
        }
    }

    private render(): void {
        this.contentEl.empty();
        this.contentEl.addClass("sls-review-harness");
        this.contentEl.dataset.testid = "review-harness";
        this.contentEl.createEl("h2", { text: "Self-hosted LiveSync review harness" });
        this.contentEl.createEl("p", {
            text: "Use a dedicated test Vault. Read-only scenarios are labelled. The Vault round-trip scenario writes only after confirmation, owns one fixed fixture tree, and removes it in a finally block. The Harness never accepts arbitrary commands, paths, code, or remote credentials.",
            cls: "sls-review-harness__warning",
        });
        this.contentEl.createEl("p", {
            text: "Automatic scenarios inspect local contracts. The guided compatibility review uses the same device-local pause and explicit action as normal start-up. Real P2P transport remains covered by the Compose E2E suite.",
        });

        const snapshot = this.controller.snapshot();
        if (snapshot.continuationError) {
            this.contentEl.createEl("p", {
                text: `Continuation error: ${snapshot.continuationError}`,
                cls: "sls-review-harness__error",
            });
        } else if (snapshot.resumedRequestId) {
            const resumed = this.contentEl.createEl("p", {
                text: "The one-shot restart continuation was consumed. Complete the guided review below.",
                cls: "sls-review-harness__resumed",
            });
            resumed.dataset.testid = "review-harness-resumed";
        }

        const suiteActions = new Setting(this.contentEl)
            .setName("Review suite")
            .setDesc(snapshot.running ? `Running ${snapshot.current ?? "scenario"}.` : "Choose the scope to run.")
            .setClass("sls-review-harness__actions");
        this.addActionButton(suiteActions, "Automatic", "review-harness-run-automatic", () =>
            this.controller.runAutomaticScenarios()
        );
        this.addActionButton(suiteActions, "Full review", "review-harness-run-full", () =>
            this.controller.runAllScenarios()
        );
        this.addActionButton(suiteActions, "Copy Markdown report", "review-harness-copy-report", async () => {
            await this.controller.copyReport();
            new Notice("Review Harness Markdown report copied.");
        });

        this.contentEl.createEl("h3", { text: "Scenarios" });
        for (const { id } of REVIEW_HARNESS_SCENARIOS) this.renderScenario(id);

        this.contentEl.createEl("p", {
            text: "Reports are copied locally and are not transmitted. They omit Vault identifiers, paths, contents, remote configuration, and secrets.",
            cls: "sls-review-harness__privacy",
        });
    }
}
