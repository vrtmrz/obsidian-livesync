import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyedNoticeManager } from "@vrtmrz/obsidian-plugin-kit/notice";

import type { App, Plugin } from "@/deps";
import { eventHub } from "@/common/events";
import { translateLiveSyncMessage } from "@/common/translation";
import type ObsidianLiveSyncPlugin from "@/main";
import { observeServiceContext } from "../../../test/contracts/serviceContext";
import type { ObsidianNoticeGroups } from "./ObsidianNoticeGroups";
import { ObsidianServiceContext } from "./ObsidianServiceContext";

const TRANSLATION_KEY = "Replicator.Message.InitialiseFatalError";

function createContext() {
    const app = {} as App;
    const plugin = {} as Plugin;
    const liveSyncPlugin = {} as ObsidianLiveSyncPlugin;
    const notices = {} as KeyedNoticeManager;
    const noticeGroups = {} as ObsidianNoticeGroups;
    const context = new ObsidianServiceContext(app, plugin, liveSyncPlugin, notices, noticeGroups);
    return { context, app, plugin, liveSyncPlugin, notices, noticeGroups };
}

describe("ObsidianServiceContext contract", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("reads visibility from the current active document without retaining the original window", () => {
        const context = Object.create(ObsidianServiceContext.prototype) as ObsidianServiceContext;
        vi.stubGlobal("activeWindow", { document: { hidden: false } });
        expect(context.isHostActive()).toBe(true);
        vi.stubGlobal("activeWindow", { document: { hidden: true } });
        expect(context.isHostActive()).toBe(false);
    });

    it("preserves the plug-in capabilities and host-neutral API results", () => {
        const { context, app, plugin, liveSyncPlugin, notices, noticeGroups } = createContext();

        expect(observeServiceContext(context, TRANSLATION_KEY)).toEqual({
            translation: translateLiveSyncMessage(TRANSLATION_KEY),
            receivedEvents: ["context-contract-event"],
        });
        expect(context.events).toBe(eventHub);
        expect(context.app).toBe(app);
        expect(context.plugin).toBe(plugin);
        expect(context.liveSyncPlugin).toBe(liveSyncPlugin);
        expect(context.notices).toBe(notices);
        expect(context.noticeGroups).toBe(noticeGroups);
    });

    it("publishes network observations for its own context, including a notification that confirms the initial state", () => {
        vi.stubGlobal("navigator", { onLine: true });
        const { context } = createContext();
        const { context: otherContext } = createContext();
        const observed = vi.fn();
        context.networkState.onChanged(({ value }) => observed(value));

        expect(context.networkState.value).toEqual({ online: true });
        context.recordNetworkState(true);
        context.recordNetworkState(false);

        expect(observed.mock.calls).toEqual([
            [{ online: true, notifiedAt: expect.any(Number) }],
            [{ online: false, notifiedAt: expect.any(Number) }],
        ]);
        expect(context.networkState.value.online).toBe(false);
        expect(otherContext.networkState.value).toEqual({ online: true });
    });
});
