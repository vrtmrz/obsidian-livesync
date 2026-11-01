import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { BrowserUiNotifications, createBrowserUi } from "@vrtmrz/browser-ui-kit";

import { createNativeElement } from "@/apps/browserDom";
import { renderMessageMarkdownInto } from "./ui/renderMessageMarkdown";
import { UiInteractionsConfirm } from "./UiInteractionsConfirm";
import { createBrowserUiScope, type BrowserUiScope } from "./BrowserUiScope";

/**
 * Compatibility facade consumed by Commonlib while browser presentation is
 * implemented through Fancy Kit's neutral `UiInteractions` contract.
 */
export class BrowserConfirm<T extends ServiceContext> extends UiInteractionsConfirm {
    readonly context: T;

    constructor(context: T, ui: BrowserUiScope = createBrowserUiScope(context)) {
        const notifications = new BrowserUiNotifications({
            document: ui.document,
        });
        super({
            ui: createBrowserUi({
                document: ui.document,
                signal: ui.signal,
                renderMarkdown: ({ container, markdown }) => {
                    renderMessageMarkdownInto(container, markdown);
                },
            }),
            notifications,
            createActionAnchor: () => createNativeElement(ui.document, "a"),
        });
        this.context = context;
        if (ui.signal.aborted) {
            notifications.dispose();
        } else {
            ui.signal.addEventListener("abort", () => notifications.dispose(), { once: true });
        }
    }
}
