// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type PromiseWithResolvers } from "octagonal-wheels/promises";
export declare class MenuItem {
    type: string;
    title: string;
    handler?: () => void | Promise<void>;
    icon: string;
    setTitle(title: string): this;
    onClick(callback: () => void | Promise<void>): this;
    setIcon(icon: string | null): this;
}
export declare class MenuSeparator {
    type: string;
}
export declare class Menu {
    type: string;
    items: (MenuItem | MenuSeparator)[];
    constructor();
    addItem(callback: (item: MenuItem) => void): this;
    addSeparator(): this;
    waitingForClose?: PromiseWithResolvers<void>;
    showAtPosition(pos: {
        x: number;
        y: number;
    }): Promise<void>;
    hide(): void;
}
