import { promiseWithResolver, type PromiseWithResolvers } from "octagonal-wheels/promises";
import { mount } from "svelte";
import MenuView from "./ui/MenuView.svelte";
import { _activeDocument } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";

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

    constructor() {}
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
    showAtPosition(pos: { x: number; y: number }) {
        const el = _activeDocument.createElement("div");
        if (this.waitingForClose) {
            this.waitingForClose.resolve();
        }
        this.waitingForClose = promiseWithResolver<void>();
        mount(MenuView, {
            target: el,
            props: {
                items: this.items,
                closeMenu: () => {
                    this.waitingForClose?.resolve();
                    this.waitingForClose = undefined;
                },
                x: pos.x,
                y: pos.y,
            },
        });
        _activeDocument.body.appendChild(el);
        void this.waitingForClose.promise.finally(() => {
            el.remove();
        });
        return this.waitingForClose.promise;
    }
    hide() {
        this.waitingForClose?.resolve();
        this.waitingForClose = undefined;
    }
}
