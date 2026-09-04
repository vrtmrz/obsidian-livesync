import { describe, expect, it, vi } from "vitest";
import { POSTPONED, ConflictResolveModal } from "./ConflictResolveModal.ts";
import { CANCELLED, type diff_result, type FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { EVENT_CONFLICT_CANCELLED, EVENT_PLUGIN_UNLOADED, eventHub } from "@/common/events.ts";

vi.mock("@/deps.ts", () => ({
    App: class App {},
    Modal: class Modal {
        createdButtons: string[] = [];

        private createElement(): Record<string, unknown> {
            const element: Record<string, unknown> = {
                addClass: vi.fn(),
                addEventListener: vi.fn(),
                appendText: vi.fn(),
                classList: {
                    add: vi.fn(),
                    remove: vi.fn(),
                },
                empty: vi.fn(),
                querySelector: vi.fn(() => null),
                querySelectorAll: vi.fn(() => []),
                scrollIntoView: vi.fn(),
                setText: vi.fn(),
            };
            element.createDiv = vi.fn(() => this.createElement());
            element.createEl = vi.fn((_tag: string, _options?: unknown, callback?: (child: unknown) => void) => {
                if (_tag === "button" && typeof _options === "object" && _options !== null && "text" in _options) {
                    this.createdButtons.push(String((_options as { text: unknown }).text));
                }
                const child = this.createElement();
                callback?.(child);
                return child;
            });
            element.createSpan = vi.fn(() => this.createElement());
            return element;
        }

        contentEl = this.createElement();
        titleEl = {
            setText: vi.fn(),
        };

        close() {
            (this as { onClose?: () => void }).onClose?.();
        }
    },
}));

const conflict: diff_result = {
    left: { rev: "2-left", data: "left", ctime: 1, mtime: 2 },
    right: { rev: "2-right", data: "right", ctime: 1, mtime: 2 },
    diff: [],
};

describe("ConflictResolveModal result lifecycle", () => {
    it("returns a response which closes the dialogue before the caller begins waiting", async () => {
        const modal = new ConflictResolveModal({} as never, "early-response.md" as FilePathWithPrefix, conflict);

        modal.sendResponse(POSTPONED);
        const result = await Promise.race([
            modal.waitForResult(),
            new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 250)),
        ]);

        expect(result).toBe(POSTPONED);
    });

    it("cancels the previous same-path dialogue without cancelling the replacement", async () => {
        const filename = "same-path.md" as FilePathWithPrefix;
        const previous = new ConflictResolveModal({} as never, filename, conflict);
        const replacement = new ConflictResolveModal({} as never, filename, conflict);
        previous.onOpen();

        replacement.onOpen();
        const previousResult = await Promise.race([
            previous.waitForResult(),
            new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 250)),
        ]);
        const replacementState = await Promise.race([
            replacement.waitForResult(),
            new Promise<"still-open">((resolve) => setTimeout(() => resolve("still-open"), 25)),
        ]);

        previous.sendResponse(CANCELLED);
        replacement.sendResponse(CANCELLED);

        expect(previousResult).toBe(CANCELLED);
        expect(replacementState).toBe("still-open");
    });

    it("closes for an external resolution of the same file and ignores other files", async () => {
        const filename = "resolved-elsewhere.md" as FilePathWithPrefix;
        const modal = new ConflictResolveModal({} as never, filename, conflict);
        modal.onOpen();

        eventHub.emitEvent(EVENT_CONFLICT_CANCELLED, "other.md" as FilePathWithPrefix);
        const stateAfterOtherFile = await Promise.race([
            modal.waitForResult(),
            new Promise<"still-open">((resolve) => setTimeout(() => resolve("still-open"), 25)),
        ]);
        eventHub.emitEvent(EVENT_CONFLICT_CANCELLED, filename);

        await expect(modal.waitForResult()).resolves.toBe(CANCELLED);
        expect(stateAfterOtherFile).toBe("still-open");
    });

    it("closes and completes its result when the plug-in unloads", async () => {
        const modal = new ConflictResolveModal(
            {} as never,
            "open-during-unload.md" as FilePathWithPrefix,
            conflict
        );
        modal.onOpen();

        eventHub.emitEvent(EVENT_PLUGIN_UNLOADED);
        const result = await Promise.race([
            modal.waitForResult(),
            new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 25)),
        ]);
        modal.sendResponse(CANCELLED);

        expect(result).toBe(CANCELLED);
    });

    it("renders a read-only comparison with no resolution actions", () => {
        const ReadOnlyModal = ConflictResolveModal as unknown as new (
            ...args: unknown[]
        ) => ConflictResolveModal & { createdButtons: string[] };
        const modal = new ReadOnlyModal({}, "repair-preview.md", conflict, false, undefined, {
            readOnly: true,
            title: "Vault and database revision",
            localName: "Vault file",
            remoteName: "Database revision",
        });

        modal.onOpen();

        expect(modal.createdButtons).toContain("Close");
        expect(modal.createdButtons).not.toContain("Use Vault file");
        expect(modal.createdButtons).not.toContain("Use Database revision");
        expect(modal.createdButtons).not.toContain("Concat both");
        expect(modal.createdButtons).not.toContain("Not now");
        modal.close();
    });

    it("does not cancel an active conflict dialogue when a read-only comparison opens for the same file", async () => {
        const filename = "repair-alongside-conflict.md" as FilePathWithPrefix;
        const previous = new ConflictResolveModal({} as never, filename, conflict);
        const ReadOnlyModal = ConflictResolveModal as unknown as new (...args: unknown[]) => ConflictResolveModal;
        const comparison = new ReadOnlyModal({}, filename, conflict, false, undefined, {
            readOnly: true,
        });
        previous.onOpen();

        comparison.onOpen();
        const previousState = await Promise.race([
            previous.waitForResult(),
            new Promise<"still-open">((resolve) => setTimeout(() => resolve("still-open"), 25)),
        ]);

        previous.sendResponse(CANCELLED);
        comparison.close();

        expect(previousState).toBe("still-open");
    });
});
