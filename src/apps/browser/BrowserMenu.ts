import { fireAndForget, promiseWithResolvers, type PromiseWithResolvers } from "octagonal-wheels/promises";
import { createNativeElement } from "@/apps/browserDom";
import type { BrowserUiOptions } from "./BrowserUiScope";
import { mount, unmount } from "svelte";
import MenuView from "./ui/MenuView.svelte";
import { _activeDocument } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";

type MountedMenu = ReturnType<typeof mount>;
type MenuSession = {
    waitingForClose: PromiseWithResolvers<void>;
    element: HTMLElement;
    component?: MountedMenu;
    abortListener?: () => void;
    closed: boolean;
};

export class MenuItem {
    type = "item";
    title = "";
    handler?: () => void | Promise<void>;
    icon: string = "";
    setTitle(title: string) {
        this.title = title;
        return this;
    }
    onClick(callback: () => void | Promise<void>) {
        this.handler = callback;
        return this;
    }
    setIcon(icon: string | null) {
        this.icon = icon || "";
        return this;
    }
}
export class MenuSeparator {
    type = "separator";
}
export class Menu {
    type = "menu";
    items: (MenuItem | MenuSeparator)[] = [];

    private readonly document: Document;
    private readonly signal?: AbortSignal;
    private activeSession?: MenuSession;

    constructor(options: BrowserUiOptions = {}) {
        this.document = options.document ?? _activeDocument;
        this.signal = options.signal;
    }

    addItem(callback: (item: MenuItem) => void) {
        const item = new MenuItem();
        callback(item);
        this.items.push(item);
        return this;
    }
    addSeparator() {
        this.items.push(new MenuSeparator());
        return this;
    }
    waitingForClose?: PromiseWithResolvers<void>;

    showAtPosition(pos: { x: number; y: number }): Promise<void> {
        if (this.activeSession) {
            this.closeSession(this.activeSession);
        }
        if (this.signal?.aborted) {
            this.waitingForClose = undefined;
            return Promise.resolve();
        }

        const waitingForClose = promiseWithResolvers<void>();
        const element = createNativeElement(this.document, "div");
        const session: MenuSession = {
            waitingForClose,
            element,
            closed: false,
        };
        this.activeSession = session;
        this.waitingForClose = waitingForClose;

        const closeMenu = () => this.closeSession(session);
        session.abortListener = closeMenu;
        this.signal?.addEventListener("abort", closeMenu, { once: true });

        try {
            session.component = mount(MenuView, {
                target: element,
                props: {
                    items: this.items,
                    closeMenu,
                    x: pos.x,
                    y: pos.y,
                },
            });
            if (!session.closed) {
                this.document.body.appendChild(element);
            } else if (session.component) {
                fireAndForget(() => unmount(session.component!));
            }
        } catch (error) {
            this.closeSession(session);
            throw error;
        }

        return waitingForClose.promise;
    }

    private closeSession(session: MenuSession): void {
        if (session.closed) return;
        session.closed = true;
        if (session.abortListener) {
            this.signal?.removeEventListener("abort", session.abortListener);
            session.abortListener = undefined;
        }
        if (this.activeSession === session) {
            this.activeSession = undefined;
            this.waitingForClose = undefined;
        }

        session.element.remove();
        if (session.component) {
            fireAndForget(() => unmount(session.component!));
        }
        session.waitingForClose.resolve();
    }

    hide() {
        if (this.activeSession) {
            this.closeSession(this.activeSession);
        }
    }
}
