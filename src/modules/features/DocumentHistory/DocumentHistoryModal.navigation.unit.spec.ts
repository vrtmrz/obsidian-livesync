import { describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({
    Modal: class Modal {},
    TFile: class TFile {},
}));

vi.mock("@/main.ts", () => ({
    default: class ObsidianLiveSyncPlugin {},
}));

vi.mock("@/common/utils.ts", () => ({
    getPathFromTFile: (file: { path: string }) => file.path,
    isValidPath: vi.fn(() => true),
}));

vi.mock("octagonal-wheels/concurrency/lock", () => ({
    scheduleOnceIfDuplicated: vi.fn((_key: string, callback: () => unknown) => callback()),
}));

import { scheduleOnceIfDuplicated } from "octagonal-wheels/concurrency/lock";
import { DocumentHistoryModal } from "./DocumentHistoryModal.ts";

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
    const contentView = {
        querySelectorAll: vi.fn(() => targets),
        querySelector: vi.fn(() => (targets.includes(focused.current as NavigationTarget) ? focused.current : null)),
    };
    return {
        contentView,
        targets,
        replaceTargets(targetCount: number) {
            focused.current = undefined;
            targets = createTargets(targetCount);
            return targets;
        },
    };
}

function createHistoryModal() {
    return Object.create(DocumentHistoryModal.prototype) as DocumentHistoryModal;
}

describe("DocumentHistoryModal cyclic navigation", () => {
    it("commits the selected index before scrolling, including when scrolling fails", () => {
        const modal = createHistoryModal();
        const view = createDiffView(2);
        const indicator = { setText: vi.fn() };
        const failure = new Error("fixture scroll failed");
        Object.assign(modal, { contentView: view.contentView, currentDiffIndex: -1, diffNavIndicator: indicator });
        view.targets[0].scrollIntoView.mockImplementation(() => {
            expect(modal.currentDiffIndex).toBe(0);
            throw failure;
        });
        expect(() => modal.navigateDiff("next")).toThrow(failure);
        expect(modal.currentDiffIndex).toBe(0);
        expect(indicator.setText).not.toHaveBeenCalled();
    });

    it("starts at the first diff for next and at the last diff for previous", () => {
        const nextModal = createHistoryModal();
        const nextView = createDiffView(3);
        const nextIndicator = { setText: vi.fn() };
        Object.assign(nextModal, {
            contentView: nextView.contentView,
            currentDiffIndex: -1,
            diffNavIndicator: nextIndicator,
        });

        nextModal.navigateDiff("next");

        expect(nextModal.currentDiffIndex).toBe(0);
        expect(nextView.targets[0].classList.add).toHaveBeenCalledWith("diff-focused");
        expect(nextView.targets[0].scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
        expect(nextIndicator.setText).toHaveBeenCalledWith("1/3");

        const previousModal = createHistoryModal();
        const previousView = createDiffView(3);
        const previousIndicator = { setText: vi.fn() };
        Object.assign(previousModal, {
            contentView: previousView.contentView,
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
        const modal = createHistoryModal();
        const { contentView, targets } = createDiffView(3);
        const indicator = { setText: vi.fn() };
        Object.assign(modal, { contentView, currentDiffIndex: -1, diffNavIndicator: indicator });

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

    it("leaves the current navigation index and content view untouched when no diff exists", () => {
        const modal = createHistoryModal();
        const { contentView } = createDiffView(0);
        const indicator = { setText: vi.fn() };
        Object.assign(modal, { contentView, currentDiffIndex: 1, diffNavIndicator: indicator });

        modal.navigateDiff("next");

        expect(modal.currentDiffIndex).toBe(1);
        expect(contentView.querySelector).not.toHaveBeenCalled();
        expect(indicator.setText).not.toHaveBeenCalled();
    });

    it("looks up diff nodes again after the content view is replaced", () => {
        const modal = createHistoryModal();
        const view = createDiffView(2);
        const indicator = { setText: vi.fn() };
        Object.assign(modal, { contentView: view.contentView, currentDiffIndex: -1, diffNavIndicator: indicator });

        modal.navigateDiff("next");
        const replacementTargets = view.replaceTargets(3);
        modal.navigateDiff("next");

        expect(modal.currentDiffIndex).toBe(1);
        expect(view.contentView.querySelectorAll).toHaveBeenCalledTimes(2);
        expect(view.contentView.querySelector).toHaveBeenCalledTimes(2);
        expect(replacementTargets[1].classList.add).toHaveBeenCalledWith("diff-focused");
        expect(replacementTargets[1].scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
        expect(indicator.setText.mock.calls.map(([text]) => text)).toEqual(["1/2", "2/3"]);
    });

    it("keeps navigation indices and focus independent between modal instances", () => {
        const firstModal = createHistoryModal();
        const secondModal = createHistoryModal();
        const firstView = createDiffView(2);
        const secondView = createDiffView(2);
        Object.assign(firstModal, {
            contentView: firstView.contentView,
            currentDiffIndex: -1,
            diffNavIndicator: { setText: vi.fn() },
        });
        Object.assign(secondModal, {
            contentView: secondView.contentView,
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

    it("resets the indicator and visibility according to showDiff", () => {
        const modal = createHistoryModal();
        const view = createDiffView(2);
        const indicator = { setText: vi.fn() };
        const diffNavContainer = { setCssStyles: vi.fn() };
        const diffOnlyLabel = { setCssStyles: vi.fn() };
        Object.assign(modal, {
            contentView: view.contentView,
            currentDiffIndex: 1,
            diffNavIndicator: indicator,
            diffNavContainer,
            diffOnlyLabel,
            showDiff: true,
        });

        modal.resetDiffNavigation();

        expect(modal.currentDiffIndex).toBe(-1);
        expect(view.contentView.querySelectorAll).toHaveBeenCalledWith(".history-added, .history-deleted");
        expect(indicator.setText).toHaveBeenLastCalledWith("0/2");
        expect(diffNavContainer.setCssStyles).toHaveBeenLastCalledWith({ display: "flex" });
        expect(diffOnlyLabel.setCssStyles).toHaveBeenLastCalledWith({ display: "inline-block" });

        view.replaceTargets(0);
        modal.resetDiffNavigation();
        expect(indicator.setText).toHaveBeenLastCalledWith("\u2014");

        Object.assign(modal, { showDiff: false });
        modal.resetDiffNavigation();
        expect(view.contentView.querySelectorAll).toHaveBeenCalledTimes(2);
        expect(indicator.setText).toHaveBeenLastCalledWith("\u2014");
        expect(diffNavContainer.setCssStyles).toHaveBeenLastCalledWith({ display: "none" });
        expect(diffOnlyLabel.setCssStyles).toHaveBeenLastCalledWith({ display: "none" });
    });

    it("updates visibility without an indicator", () => {
        const modal = createHistoryModal();
        const { contentView } = createDiffView(2);
        const diffNavContainer = { setCssStyles: vi.fn() };
        Object.assign(modal, { contentView, currentDiffIndex: 1, diffNavContainer, showDiff: true });

        expect(() => modal.resetDiffNavigation()).not.toThrow();

        expect(modal.currentDiffIndex).toBe(-1);
        expect(contentView.querySelectorAll).not.toHaveBeenCalled();
        expect(diffNavContainer.setCssStyles).toHaveBeenCalledWith({ display: "flex" });
    });

    it("maps selected search results to the revision slider and loads each wrapped selection", () => {
        const modal = createHistoryModal();
        const scheduleLoad = vi.mocked(scheduleOnceIfDuplicated);
        scheduleLoad.mockClear();
        const indicator = { setText: vi.fn() };
        Object.assign(modal, {
            searchResults: [
                { rev: "newest", index: 0, matchType: "Content" },
                { rev: "middle", index: 2, matchType: "Diff" },
                { rev: "oldest", index: 4, matchType: "Content" },
            ],
            currentSearchIndex: -1,
            revs_info: Array.from({ length: 5 }, (_, index) => ({ rev: `rev-${index}` })),
            range: { value: "" },
            loadRevs: vi.fn(),
            searchResultIndicator: indicator,
            searchPrevBtn: { disabled: true },
            searchNextBtn: { disabled: true },
            searchKeyword: "needle",
            showDiff: false,
        });

        modal.navigateSearch("next");
        expect(modal.currentSearchIndex).toBe(0);
        expect(modal.range.value).toBe("4");
        expect(modal.loadRevs).toHaveBeenCalledTimes(1);
        expect(scheduleLoad).toHaveBeenCalledWith("loadRevs", expect.any(Function));
        expect(indicator.setText).toHaveBeenLastCalledWith("1/3 matches");

        modal.navigateSearch("next");
        expect(modal.currentSearchIndex).toBe(1);
        expect(modal.range.value).toBe("2");
        expect(modal.loadRevs).toHaveBeenCalledTimes(2);

        modal.navigateSearch("next");
        expect(modal.currentSearchIndex).toBe(2);
        expect(modal.range.value).toBe("0");

        modal.navigateSearch("next");
        expect(modal.currentSearchIndex).toBe(0);
        expect(modal.range.value).toBe("4");

        modal.navigateSearch("prev");
        expect(modal.currentSearchIndex).toBe(2);
        expect(modal.range.value).toBe("0");
        expect(indicator.setText.mock.calls.map(([text]) => text)).toEqual([
            "1/3 matches",
            "2/3 matches",
            "3/3 matches",
            "1/3 matches",
            "3/3 matches",
        ]);
    });

    it("leaves search state and controls untouched when there are no results", () => {
        const modal = createHistoryModal();
        const indicator = { setText: vi.fn() };
        const searchPrevBtn = { disabled: true };
        const searchNextBtn = { disabled: true };
        Object.assign(modal, {
            searchResults: [],
            currentSearchIndex: -1,
            range: { value: "unchanged" },
            loadRevs: vi.fn(),
            searchResultIndicator: indicator,
            searchPrevBtn,
            searchNextBtn,
            searchKeyword: "needle",
            showDiff: false,
        });

        modal.navigateSearch("next");

        expect(modal.currentSearchIndex).toBe(-1);
        expect(modal.range.value).toBe("unchanged");
        expect(modal.loadRevs).not.toHaveBeenCalled();
        expect(indicator.setText).not.toHaveBeenCalled();
        expect(searchPrevBtn.disabled).toBe(true);
        expect(searchNextBtn.disabled).toBe(true);
    });
});
