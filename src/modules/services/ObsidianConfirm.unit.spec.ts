import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    confirmAction: vi.fn(),
    pickOne: vi.fn(),
    promptPassword: vi.fn(),
    promptText: vi.fn(),
    legacyAskSelectString: vi.fn(),
    legacyAskString: vi.fn(),
    legacyAskYesNo: vi.fn(),
    legacyConfirm: vi.fn(),
    legacyWideConfirm: vi.fn(),
}));

vi.mock("@vrtmrz/obsidian-plugin-kit", () => ({
    confirmAction: mocks.confirmAction,
    pickOne: mocks.pickOne,
    promptPassword: mocks.promptPassword,
    promptText: mocks.promptText,
}));

vi.mock("@/modules/coreObsidian/UILib/dialogs", () => ({
    askSelectString: mocks.legacyAskSelectString,
    askString: mocks.legacyAskString,
    askYesNo: mocks.legacyAskYesNo,
    confirmWithMessage: mocks.legacyConfirm,
    confirmWithMessageWithWideButton: mocks.legacyWideConfirm,
}));

vi.mock("@/deps", () => ({
    Notice: class {},
}));

import { EVENT_PLUGIN_UNLOADED } from "@/common/events";
import { memoObject, retrieveMemoObject } from "@/common/utils";
import { createLiveSyncEventHub } from "@vrtmrz/livesync-commonlib/context";
import { ObsidianConfirm } from "./ObsidianConfirm";
import type { ObsidianServiceContext } from "./ObsidianServiceContext";

function createConfirm() {
    const app = { id: "app" };
    const plugin = { app };
    const events = createLiveSyncEventHub();
    const context = { app, plugin, events } as unknown as ObsidianServiceContext;
    return { confirm: new ObsidianConfirm(context), events, app, plugin };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("ObsidianConfirm Fancy Kit adapter", () => {
    it("uses owner-bound Kit prompts and preserves cancellation and empty input", async () => {
        const { confirm, app } = createConfirm();
        mocks.promptText.mockResolvedValueOnce(null);
        mocks.promptPassword.mockResolvedValueOnce("");

        await expect(confirm.askString("Name", "Device name", "New Remote")).resolves.toBe(false);
        await expect(confirm.askString("Secret", "Passphrase", "Enter it", true)).resolves.toBe("");

        expect(mocks.promptText).toHaveBeenCalledWith(
            app,
            {
                title: "Name",
                label: "Device name",
                placeholder: "New Remote",
            },
            { signal: expect.any(AbortSignal) }
        );
        expect(mocks.promptPassword).toHaveBeenCalledWith(
            app,
            {
                title: "Secret",
                label: "Passphrase",
                placeholder: "Enter it",
            },
            { signal: expect.any(AbortSignal) }
        );
        expect(mocks.legacyAskString).not.toHaveBeenCalled();
    });

    it("uses Kit for untimed yes/no and typed selection while preserving dismissed results", async () => {
        const { confirm, app } = createConfirm();
        mocks.confirmAction.mockResolvedValueOnce("yes");
        mocks.pickOne.mockResolvedValueOnce("Beta").mockResolvedValueOnce(null);

        await expect(confirm.askYesNo("Continue?")).resolves.toBe("yes");
        await expect(confirm.askSelectString("Target", ["Alpha", "Beta"])).resolves.toBe("Beta");
        await expect(confirm.askSelectString("Target", ["Alpha"])).resolves.toBe("");

        expect(mocks.confirmAction).toHaveBeenCalledWith(
            app,
            expect.objectContaining({
                message: "Continue?",
                actions: ["yes", "no"],
                actionLayout: "vertical",
                defaultAction: "no",
            }),
            { signal: expect.any(AbortSignal) }
        );
        expect(mocks.pickOne).toHaveBeenCalledWith(
            app,
            expect.objectContaining({
                items: ["Alpha", "Beta"],
                getText: expect.any(Function),
            }),
            { signal: expect.any(AbortSignal) }
        );
        expect(mocks.legacyAskYesNo).not.toHaveBeenCalled();
        expect(mocks.legacyAskSelectString).not.toHaveBeenCalled();
    });

    it("keeps untimed and countdown action dialogues vertically stacked", async () => {
        const { confirm, app, plugin } = createConfirm();
        mocks.confirmAction.mockResolvedValueOnce("Apply").mockResolvedValueOnce("Yes");
        mocks.legacyWideConfirm.mockResolvedValueOnce("Cancel").mockResolvedValueOnce("No");

        await expect(confirm.confirmWithMessage("Review", "**Apply?**", ["Apply", "Cancel"], "Cancel")).resolves.toBe(
            "Apply"
        );
        await expect(confirm.askYesNoDialog("Continue?", { title: "Question", defaultOption: "Yes" })).resolves.toBe(
            "yes"
        );
        await expect(confirm.confirmWithMessage("Timed", "Wait", ["Apply", "Cancel"], "Cancel", 30)).resolves.toBe(
            "Cancel"
        );
        await expect(confirm.askYesNoDialog("Timed?", { defaultOption: "No", timeout: 10 })).resolves.toBe("no");

        expect(mocks.confirmAction).toHaveBeenNthCalledWith(
            1,
            app,
            {
                title: "Review",
                message: "**Apply?**",
                actions: ["Apply", "Cancel"],
                actionLayout: "vertical",
                defaultAction: "Cancel",
                sourcePath: "/",
            },
            { signal: expect.any(AbortSignal) }
        );
        expect(mocks.confirmAction).toHaveBeenNthCalledWith(
            2,
            app,
            expect.objectContaining({
                title: "Question",
                message: "Continue?",
                actions: ["Yes", "No"],
                actionLayout: "vertical",
                defaultAction: "Yes",
            }),
            { signal: expect.any(AbortSignal) }
        );
        expect(mocks.legacyWideConfirm).toHaveBeenNthCalledWith(
            1,
            plugin,
            "Timed",
            "Wait",
            ["Apply", "Cancel"],
            "Cancel",
            30
        );
        expect(mocks.legacyWideConfirm).toHaveBeenNthCalledWith(
            2,
            plugin,
            expect.any(String),
            "Timed?",
            expect.any(Array),
            expect.any(String),
            10
        );
        expect(mocks.legacyConfirm).not.toHaveBeenCalled();
    });

    it("uses Kit for untimed multi-action selection and keeps timed wide actions on the countdown dialogue", async () => {
        const { confirm, app, plugin } = createConfirm();
        const actions = ["Apply now", "Review later"] as const;
        mocks.confirmAction.mockResolvedValueOnce("Review later");
        mocks.legacyWideConfirm.mockResolvedValueOnce("Apply now");

        await expect(
            confirm.askSelectStringDialogue("Choose the next step", actions, {
                title: "Next step",
                defaultAction: "Review later",
            })
        ).resolves.toBe("Review later");
        await expect(
            confirm.askSelectStringDialogue("Choose before the timer expires", actions, {
                title: "Timed step",
                defaultAction: "Apply now",
                timeout: 15,
            })
        ).resolves.toBe("Apply now");

        expect(mocks.confirmAction).toHaveBeenCalledWith(
            app,
            {
                title: "Next step",
                message: "Choose the next step",
                actions,
                actionLayout: "vertical",
                defaultAction: "Review later",
                sourcePath: "/",
            },
            { signal: expect.any(AbortSignal) }
        );
        expect(mocks.legacyWideConfirm).toHaveBeenCalledWith(
            plugin,
            "Timed step",
            "Choose before the timer expires",
            actions,
            "Apply now",
            15
        );
    });

    it("dismisses an open Kit dialogue when the plug-in unload event is emitted", async () => {
        const { confirm, events } = createConfirm();
        let observedSignal: AbortSignal | undefined;
        mocks.confirmAction.mockImplementation(
            (_app, _options, lifecycle: { signal: AbortSignal }) =>
                new Promise<null>((resolve) => {
                    observedSignal = lifecycle.signal;
                    lifecycle.signal.addEventListener("abort", () => resolve(null), { once: true });
                })
        );

        const result = confirm.confirmWithMessage("Review", "Message", ["OK"], "OK");
        expect(observedSignal?.aborted).toBe(false);

        events.emitEvent(EVENT_PLUGIN_UNLOADED);

        await expect(result).resolves.toBe(false);
        expect(observedSignal?.aborted).toBe(true);
    });

    it("closes an active Notice when the plug-in unload event is emitted", () => {
        const { confirm, events } = createConfirm();
        const popupKey = "popup-remote-size-exceeded";
        const popup = {
            hide: vi.fn(),
            noticeEl: { isShown: vi.fn(() => true) },
        };
        memoObject(popupKey, popup);
        (confirm as unknown as { popupKeys: Set<string> }).popupKeys.add(popupKey);

        events.emitEvent(EVENT_PLUGIN_UNLOADED);

        expect(popup.hide).toHaveBeenCalledOnce();
        expect(retrieveMemoObject(popupKey)).toBe(false);
    });
});
