import { MarkdownRenderer } from "@/deps.ts";
import { fireAndForget } from "octagonal-wheels/promises";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
//@ts-ignore
const updateInformation: string = UPDATE_INFO || "";

export function paneChangeLog(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement): void {
    const informationDivEl = this.createEl(paneEl, "div", { text: "" });
    fireAndForget(() =>
        MarkdownRenderer.render(this.plugin.app, updateInformation, informationDivEl, "/", this.lifetimeComponent)
    );
}
