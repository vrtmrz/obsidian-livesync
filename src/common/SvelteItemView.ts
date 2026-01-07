import { ItemView } from "@/deps.ts";
import { type mount, unmount } from "svelte";

export abstract class SvelteItemView extends ItemView {
    abstract instantiateComponent(target: HTMLElement): ReturnType<typeof mount> | Promise<ReturnType<typeof mount>>;
    component?: ReturnType<typeof mount>;
    async onOpen() {
        await super.onOpen();
        this.contentEl.empty();
        await this._dismountComponent();
        this.component = await this.instantiateComponent(this.contentEl);
        return;
    }
    async _dismountComponent() {
        if (this.component) {
            await unmount(this.component);
            this.component = undefined;
        }
    }
    async onClose() {
        await super.onClose();
        if (this.component) {
            await unmount(this.component);
            this.component = undefined;
        }
        return;
    }
}
