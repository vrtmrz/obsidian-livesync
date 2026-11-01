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
        const modal = new ConflictResolveModal({} as never, "open-during-unload.md" as FilePathWithPrefix, conflict);
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

type NavigationTarget = {
    classList: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
    scrollIntoView: ReturnType<typeof vi.fn>;
};

function createDiffView(count: number) {
    const focused: { current: NavigationTarget | undefined } = { current: undefined };
    const createTargets = (targetCount: number) =>
        Array.from({ length: targetCount }, () => {
            const target: NavigationTarget = {
                classList: {
                    add: vi.fn(() => {
                        focused.current = target;
                    }),
                    remove: vi.fn(() => {
                        if (focused.current === target) focused.current = undefined;
                    }),
                },
                scrollIntoView: vi.fn(),
            };
            return target;
        });
    let targets = createTargets(count);
    const diffView = {
        querySelectorAll: vi.fn(() => targets),
        querySelector: vi.fn(() => (targets.includes(focused.current as NavigationTarget) ? focused.current : null)),
    };
    return {
        diffView,
        targets,
        replaceTargets(targetCount: number) {
            focused.current = undefined;
            targets = createTargets(targetCount);
            return targets;
        },
    };
}

describe("ConflictResolveModal cyclic navigation", () => {
    it("commits the selected index before scrolling, including when scrolling fails", () => {
        const modal = Object.create(ConflictResolveModal.prototype) as ConflictResolveModal;
        const view = createDiffView(2);
        const indicator = { setText: vi.fn() };
        const failure = new Error("fixture scroll failed");
        Object.assign(modal, { diffView: view.diffView, currentDiffIndex: -1, diffNavIndicator: indicator });
        view.targets[0].scrollIntoView.mockImplementation(() => {
            expect(modal.currentDiffIndex).toBe(0);
            throw failure;
        });
        expect(() => modal.navigateDiff("next")).toThrow(failure);
        expect(modal.currentDiffIndex).toBe(0);
        expect(indicator.setText).not.toHaveBeenCalled();
    });

    it("starts at the first diff for next and at the last diff for previous", () => {
        const nextModal = new ConflictResolveModal({} as never, "next.md" as FilePathWithPrefix, conflict);
        const nextView = createDiffView(3);
        const nextIndicator = { setText: vi.fn() };
        Object.assign(nextModal, {
            diffView: nextView.diffView,
            currentDiffIndex: -1,
            diffNavIndicator: nextIndicator,
        });

        nextModal.navigateDiff("next");

        expect(nextModal.currentDiffIndex).toBe(0);
        expect(nextView.targets[0].classList.add).toHaveBeenCalledWith("diff-focused");
        expect(nextView.targets[0].scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
        expect(nextIndicator.setText).toHaveBeenCalledWith("1/3");

        const previousModal = new ConflictResolveModal({} as never, "previous.md" as FilePathWithPrefix, conflict);
        const previousView = createDiffView(3);
        const previousIndicator = { setText: vi.fn() };
        Object.assign(previousModal, {
            diffView: previousView.diffView,
            currentDiffIndex: -1,
            diffNavIndicator: previousIndicator,
        });

        previousModal.navigateDiff("prev");

        expect(previousModal.currentDiffIndex).toBe(2);
        expect(previousView.targets[2].classList.add).toHaveBeenCalledWith("diff-focused");
        expect(previousView.targets[2].scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
        expect(previousIndicator.setText).toHaveBeenCalledWith("3/3");
    });

    it("wraps in both directions while moving focus, scrolling, and updating the indicator", () => {
        const modal = new ConflictResolveModal({} as never, "wrap.md" as FilePathWithPrefix, conflict);
        const { diffView, targets } = createDiffView(3);
        const indicator = { setText: vi.fn() };
        Object.assign(modal, { diffView, currentDiffIndex: -1, diffNavIndicator: indicator });

        modal.navigateDiff("next");
        modal.navigateDiff("next");
        modal.navigateDiff("next");
        modal.navigateDiff("next");
        modal.navigateDiff("prev");

        expect(modal.currentDiffIndex).toBe(2);
        expect(targets.map((target) => target.classList.add.mock.calls.length)).toEqual([2, 1, 2]);
        expect(targets.map((target) => target.classList.remove.mock.calls.length)).toEqual([2, 1, 1]);
        expect(targets.map((target) => target.scrollIntoView.mock.calls.length)).toEqual([2, 1, 2]);
        expect(indicator.setText.mock.calls.map(([text]) => text)).toEqual(["1/3", "2/3", "3/3", "1/3", "3/3"]);
    });

    it("leaves the current navigation index and diff view untouched when no diff exists", () => {
        const modal = new ConflictResolveModal({} as never, "empty.md" as FilePathWithPrefix, conflict);
        const { diffView } = createDiffView(0);
        const indicator = { setText: vi.fn() };
        Object.assign(modal, { diffView, currentDiffIndex: 1, diffNavIndicator: indicator });

        modal.navigateDiff("next");

        expect(modal.currentDiffIndex).toBe(1);
        expect(diffView.querySelector).not.toHaveBeenCalled();
        expect(indicator.setText).not.toHaveBeenCalled();
    });

    it("looks up diff nodes again after the diff view is replaced", () => {
        const modal = new ConflictResolveModal({} as never, "replace.md" as FilePathWithPrefix, conflict);
        const view = createDiffView(2);
        const indicator = { setText: vi.fn() };
        Object.assign(modal, { diffView: view.diffView, currentDiffIndex: -1, diffNavIndicator: indicator });

        modal.navigateDiff("next");
        const replacementTargets = view.replaceTargets(3);
        modal.navigateDiff("next");

        expect(modal.currentDiffIndex).toBe(1);
        expect(view.diffView.querySelectorAll).toHaveBeenCalledTimes(2);
        expect(view.diffView.querySelector).toHaveBeenCalledTimes(2);
        expect(replacementTargets[1].classList.add).toHaveBeenCalledWith("diff-focused");
        expect(replacementTargets[1].scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
        expect(indicator.setText.mock.calls.map(([text]) => text)).toEqual(["1/2", "2/3"]);
    });

    it("keeps navigation indices and focus independent between modal instances", () => {
        const firstModal = new ConflictResolveModal({} as never, "first.md" as FilePathWithPrefix, conflict);
        const secondModal = new ConflictResolveModal({} as never, "second.md" as FilePathWithPrefix, conflict);
        const firstView = createDiffView(2);
        const secondView = createDiffView(2);
        Object.assign(firstModal, {
            diffView: firstView.diffView,
            currentDiffIndex: -1,
            diffNavIndicator: { setText: vi.fn() },
        });
        Object.assign(secondModal, {
            diffView: secondView.diffView,
            currentDiffIndex: -1,
            diffNavIndicator: { setText: vi.fn() },
        });

        firstModal.navigateDiff("next");
        secondModal.navigateDiff("next");
        firstModal.navigateDiff("next");

        expect(firstModal.currentDiffIndex).toBe(1);
        expect(secondModal.currentDiffIndex).toBe(0);
        expect(firstView.targets[0].classList.remove).toHaveBeenCalledWith("diff-focused");
        expect(secondView.targets[0].classList.remove).not.toHaveBeenCalled();
        expect(secondView.targets[0].classList.add).toHaveBeenCalledWith("diff-focused");
    });

    it("always resets the indicator using the current diff count", () => {
        const modal = new ConflictResolveModal({} as never, "reset.md" as FilePathWithPrefix, conflict);
        const view = createDiffView(2);
        const indicator = { setText: vi.fn() };
        Object.assign(modal, { diffView: view.diffView, currentDiffIndex: 1, diffNavIndicator: indicator });

        modal.resetDiffNavigation();

        expect(modal.currentDiffIndex).toBe(-1);
        expect(view.diffView.querySelectorAll).toHaveBeenCalledWith(".added, .deleted");
        expect(indicator.setText).toHaveBeenLastCalledWith("0/2");

        view.replaceTargets(0);
        modal.resetDiffNavigation();
        expect(indicator.setText).toHaveBeenLastCalledWith("\u2014");
    });
});
