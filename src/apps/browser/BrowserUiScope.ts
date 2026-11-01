import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { EVENT_PLUGIN_UNLOADED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { _activeDocument } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";

export interface BrowserUiOptions {
    readonly document?: Document;
    readonly signal?: AbortSignal;
}

/** Browser presentation target and lifetime owned by one application context. */
export interface BrowserUiScope {
    readonly document: Document;
    readonly signal: AbortSignal;
}

export function createBrowserUiScope(
    context: Pick<ServiceContext, "events">,
    options: BrowserUiOptions = {}
): BrowserUiScope {
    const controller = new AbortController();
    const parent = options.signal;
    let unregisterUnload: (() => void) | undefined;
    const end = (reason: unknown): void => {
        if (controller.signal.aborted) return;
        unregisterUnload?.();
        unregisterUnload = undefined;
        parent?.removeEventListener("abort", onParentAbort);
        controller.abort(reason);
    };
    const onParentAbort = () => end(parent?.reason);
    if (parent?.aborted) {
        controller.abort(parent.reason);
    } else {
        unregisterUnload = context.events.onceEvent(EVENT_PLUGIN_UNLOADED, () => end(new Error("Plug-in unloaded")));
        parent?.addEventListener("abort", onParentAbort, { once: true });
    }
    return { document: options.document ?? _activeDocument, signal: controller.signal };
}
