import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { EVENT_PLUGIN_UNLOADED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";

const kit = vi.hoisted(() => ({
    uiOptions: [] as { document: Document; signal: AbortSignal }[],
    notices: [] as { document: Document; dispose: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn> }[],
}));
vi.mock("@vrtmrz/browser-ui-kit", () => ({
    createBrowserUi(options: { document: Document; signal: AbortSignal }) {
        kit.uiOptions.push(options);
        return { promptText: vi.fn(async () => "selected") };
    },
    BrowserUiNotifications: class {
        dispose = vi.fn();
        show = vi.fn();
        constructor(options: { document: Document }) {
            kit.notices.push({ document: options.document, dispose: this.dispose, show: this.show });
        }
    },
}));
import { BrowserConfirm } from "@/apps/browser/BrowserConfirm";
import { createBrowserUiScope } from "@/apps/browser/BrowserUiScope";

beforeEach(() => {
    kit.uiOptions.length = 0;
    kit.notices.length = 0;
});

describe("BrowserConfirm UI owner", () => {
    it("passes the same document and lifetime to existing Kit capabilities", async () => {
        const context = createServiceContext();
        const anchor = { textContent: "", click: vi.fn() };
        const document = { createElement: vi.fn(() => anchor) } as unknown as Document;
        const ui = createBrowserUiScope(context, { document });
        const confirm = new BrowserConfirm(context, ui);
        expect(kit.uiOptions[0]).toMatchObject({ document, signal: ui.signal });
        expect(kit.notices[0].document).toBe(document);
        await expect(confirm.askString("Title", "Value", "Placeholder")).resolves.toBe("selected");
        confirm.askInPopup("key", "Go {HERE}", (link) => {
            link.textContent = "Open";
        });
        expect(document.createElement).toHaveBeenCalledWith("a");
        expect(kit.notices[0].show).toHaveBeenCalledWith(
            "key",
            expect.objectContaining({ action: expect.objectContaining({ label: "Open" }) })
        );
        context.events.emitEvent(EVENT_PLUGIN_UNLOADED);
        expect(ui.signal.aborted).toBe(true);
        expect(kit.notices[0].dispose).toHaveBeenCalledOnce();
    });
    it("disposes only the notifications belonging to the unloaded context", () => {
        const first = createServiceContext();
        const second = createServiceContext();
        new BrowserConfirm(first, createBrowserUiScope(first, { document: {} as Document }));
        new BrowserConfirm(second, createBrowserUiScope(second, { document: {} as Document }));
        first.events.emitEvent(EVENT_PLUGIN_UNLOADED);
        first.events.emitEvent(EVENT_PLUGIN_UNLOADED);
        expect(kit.notices[0].dispose).toHaveBeenCalledOnce();
        expect(kit.notices[1].dispose).not.toHaveBeenCalled();
        second.events.emitEvent(EVENT_PLUGIN_UNLOADED);
    });
    it("disposes notifications immediately for a pre-aborted owner", () => {
        const context = createServiceContext();
        const parent = new AbortController();
        parent.abort();
        new BrowserConfirm(context, createBrowserUiScope(context, { signal: parent.signal }));
        expect(kit.uiOptions[0].signal.aborted).toBe(true);
        expect(kit.notices[0].dispose).toHaveBeenCalledOnce();
        context.events.emitEvent(EVENT_PLUGIN_UNLOADED);
        expect(kit.notices[0].dispose).toHaveBeenCalledOnce();
    });
});
