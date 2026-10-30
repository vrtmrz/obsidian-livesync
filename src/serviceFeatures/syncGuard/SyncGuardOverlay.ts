import type { SyncGuardPresentation } from "./SyncGuardState";
import { $msg } from "@/common/translation";

/** Obsidian-owned presentation: blocks workspace input but does not pause replication or other dialogues. */
export class SyncGuardOverlay {
    private root?: HTMLDivElement;
    private stage?: HTMLParagraphElement;
    private count?: HTMLParagraphElement;
    private bypassButton?: HTMLButtonElement;
    private previousFocus?: HTMLElement;

    constructor(
        private readonly workspace: HTMLElement,
        private readonly onBypass: () => void
    ) {}

    update({ phase, receivedFiles }: SyncGuardPresentation): void {
        if (phase === "idle" || phase === "observing") {
            this.close();
            return;
        }
        this.open();
        if (this.stage) {
            this.stage.textContent =
                phase === "interrupted"
                    ? $msg("Synchronisation was interrupted. You can continue locally, but some notes may be out of date.")
                    : phase === "transferring"
                      ? $msg("Receiving changes from the server…")
                      : $msg("Applying received changes to local notes…");
        }
        if (this.count) {
            this.count.textContent = $msg("At least ${COUNT} changed files received", { COUNT: `${receivedFiles}` });
        }
    }

    private open(): void {
        if (this.root) return;
        const doc = this.workspace.ownerDocument;
        const root = this.workspace.createDiv({ cls: "sls-sync-guard" });
        root.setAttribute("role", "region");
        root.setAttribute("aria-label", $msg("Synchronisation protection"));
        const panel = root.createEl("section", { cls: "sls-sync-guard-panel" });
        const title = panel.createEl("h2");
        title.textContent = $msg("Synchronising your Vault");
        const stage = panel.createEl("p", { cls: "sls-sync-guard-stage" });
        stage.setAttribute("aria-live", "polite");
        const count = panel.createEl("p", { cls: "sls-sync-guard-count" });
        const bypass = panel.createEl("button", { cls: "mod-cta sls-sync-guard-bypass" });
        bypass.type = "button";
        bypass.textContent = $msg("Continue without waiting");
        bypass.addEventListener("click", this.onBypass);
        this.root = root;
        this.stage = stage;
        this.count = count;
        this.bypassButton = bypass;
        const focused = doc.activeElement;
        const modalFocused = focused instanceof Element && focused.closest(".modal-container") !== null;
        this.previousFocus = !modalFocused && focused instanceof HTMLElement ? focused : undefined;
        doc.addEventListener("keydown", this.blockKeyboard, true);
        // Mobile input methods, dictation, and paste may mutate an editor without a keydown.
        doc.addEventListener("beforeinput", this.blockEditorInput, true);
        doc.addEventListener("paste", this.blockEditorInput, true);
        doc.addEventListener("drop", this.blockEditorInput, true);
        // Do not steal focus from an Obsidian conflict or setup dialogue which was already open.
        if (!modalFocused) bypass.focus();
    }

    /** Prevent editor shortcuts while allowing our own controls and Obsidian's conflict/setup dialogues. */
    private readonly blockKeyboard = (event: KeyboardEvent): void => {
        if (!this.root) return;
        const target = event.target;
        if (target instanceof Element && target.closest(".modal-container")) return;
        if (
            target instanceof Node &&
            this.root.contains(target) &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey &&
            (event.key === "Enter" || event.key === " ")
        ) {
            return;
        }
        // The guard has a single focusable control. Keep Tab/Shift+Tab inside it;
        // otherwise focus could move behind the overlay with no keyboard route back.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Tab") this.bypassButton?.focus();
    };

    private readonly blockEditorInput = (event: Event): void => {
        if (!this.root) return;
        const target = event.target;
        if (target instanceof Element && target.closest(".modal-container")) return;
        if (target instanceof Node && this.root.contains(target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    close(): void {
        if (!this.root) return;
        const doc = this.workspace.ownerDocument;
        const focused = doc.activeElement;
        const ownsFocus = focused instanceof Node && this.root.contains(focused);
        doc.removeEventListener("keydown", this.blockKeyboard, true);
        doc.removeEventListener("beforeinput", this.blockEditorInput, true);
        doc.removeEventListener("paste", this.blockEditorInput, true);
        doc.removeEventListener("drop", this.blockEditorInput, true);
        this.root.remove();
        this.root = undefined;
        this.stage = undefined;
        this.count = undefined;
        this.bypassButton = undefined;
        // A newer dialogue may own focus now. Never move it back to an old editor.
        if (ownsFocus && this.previousFocus?.isConnected) this.previousFocus.focus();
        this.previousFocus = undefined;
    }

    dispose(): void {
        this.close();
    }
}
