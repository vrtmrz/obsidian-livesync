import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { _activeDocument } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { EVENT_PLUGIN_UNLOADED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { BrowserUiNotifications, createBrowserUi } from "@vrtmrz/browser-ui-kit";

import { createNativeElement } from "@/apps/browserDom";
import { renderMessageMarkdownInto } from "./ui/renderMessageMarkdown";
import { UiInteractionsConfirm } from "./UiInteractionsConfirm";

/**
 * Compatibility facade consumed by Commonlib while browser presentation is
 * implemented through Fancy Kit's neutral `UiInteractions` contract.
 */
export class BrowserConfirm<T extends ServiceContext> extends UiInteractionsConfirm {
    readonly context: T;

    constructor(context: T) {
        const dialogueController = new AbortController();
        const notifications = new BrowserUiNotifications({
            document: _activeDocument,
        });
        super({
            ui: createBrowserUi({
                document: _activeDocument,
                signal: dialogueController.signal,
                renderMarkdown: ({ container, markdown }) => {
                    renderMessageMarkdownInto(container, markdown);
                },
            }),
            notifications,
            createActionAnchor: () => createNativeElement(_activeDocument, "a"),
        });
        this.context = context;
        context.events.onceEvent(EVENT_PLUGIN_UNLOADED, () => {
            dialogueController.abort();
            notifications.dispose();
        });
    }
}
