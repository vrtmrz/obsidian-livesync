import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { EVENT_PLUGIN_UNLOADED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { describe, expect, it, vi } from "vitest";
import { createBrowserUiScope } from "@/apps/browser/BrowserUiScope";

describe("browser UI scope", () => {
    it("owns its document and cancellation independently from another application", () => {
        const firstContext = createServiceContext();
        const secondContext = createServiceContext();
        const firstDocument = {} as Document;
        const secondDocument = {} as Document;
        const first = createBrowserUiScope(firstContext, { document: firstDocument });
        const second = createBrowserUiScope(secondContext, { document: secondDocument });
        const abort = vi.fn();
        first.signal.addEventListener("abort", abort);
        firstContext.events.emitEvent(EVENT_PLUGIN_UNLOADED);
        firstContext.events.emitEvent(EVENT_PLUGIN_UNLOADED);
        expect(first.document).toBe(firstDocument);
        expect(second.document).toBe(secondDocument);
        expect(first.signal.aborted).toBe(true);
        expect(first.signal.reason).toEqual(new Error("Plug-in unloaded"));
        expect(second.signal.aborted).toBe(false);
        expect(abort).toHaveBeenCalledOnce();
        secondContext.events.emitEvent(EVENT_PLUGIN_UNLOADED);
    });
    it("forwards parent cancellation and unregisters the context subscription", () => {
        const context = createServiceContext();
        const parent = new AbortController();
        const unregister = vi.fn();
        const once = vi.spyOn(context.events, "onceEvent").mockReturnValue(unregister);
        const scope = createBrowserUiScope(context, { signal: parent.signal });
        const reason = new Error("fixture host ended");
        parent.abort(reason);
        expect(scope.signal.aborted).toBe(true);
        expect(scope.signal.reason).toBe(reason);
        expect(unregister).toHaveBeenCalledOnce();
        once.mockRestore();
    });
    it("removes the parent listener on unload and does not subscribe an already aborted parent", () => {
        const context = createServiceContext();
        const parent = new AbortController();
        const remove = vi.spyOn(parent.signal, "removeEventListener");
        const scope = createBrowserUiScope(context, { signal: parent.signal });
        context.events.emitEvent(EVENT_PLUGIN_UNLOADED);
        expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
        const reason = scope.signal.reason;
        parent.abort(new Error("later"));
        expect(scope.signal.reason).toBe(reason);
        const closedContext = createServiceContext();
        const subscribe = vi.spyOn(closedContext.events, "onceEvent");
        const closed = createBrowserUiScope(closedContext, { signal: parent.signal });
        expect(closed.signal.aborted).toBe(true);
        expect(closed.signal.reason).toBe(parent.signal.reason);
        expect(subscribe).not.toHaveBeenCalled();
    });
});
