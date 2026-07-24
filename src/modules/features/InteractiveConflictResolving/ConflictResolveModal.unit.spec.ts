import { describe, expect, it, vi } from "vitest";
import { POSTPONED, ConflictResolveModal } from "./ConflictResolveModal.ts";
import { CANCELLED, type diff_result, type FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/deps.ts", () => ({
    App: class App {},
    Modal: class Modal {
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
});
