import { MarkdownRenderer, request } from "@/deps.ts";
import { $msg } from "@/common/translation";
import { LiveSyncError } from "@vrtmrz/livesync-commonlib/compat/common/LSError";
import { fireAndForget } from "octagonal-wheels/promises";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";

/** Render the online help and troubleshooting browser. */
export function paneHelp(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleOnlineTips")).then((panelEl) => {
        const lifetimeComponent = this.lifetimeComponent;
        let pageDisposed = false;
        lifetimeComponent.register(() => {
            pageDisposed = true;
        });
        const repo = "vrtmrz/obsidian-livesync";
        const topPath = $msg("obsidianLiveSyncSettingTab.linkTroubleshooting");
        const rawRepoURI = `https://raw.githubusercontent.com/${repo}/main`;
        this.createEl(panelEl, "div", "", (el) => {
            el.createEl("a", { text: $msg("obsidianLiveSyncSettingTab.linkOpenInBrowser") }, (anchor) => {
                anchor.href = `https://github.com/${repo}/blob/main${topPath}`;
                anchor.target = "_blank";
                anchor.rel = "noopener";
            });
        });
        const troubleShootEl = this.createEl(panelEl, "div", {
            text: "",
            cls: "sls-troubleshoot-preview",
        });
        const loadMarkdownPage = async (pathAll: string, basePathParam: string = "") => {
            troubleShootEl.setCssStyles({ minHeight: troubleShootEl.clientHeight + "px" });
            troubleShootEl.empty();
            const fullPath = pathAll.startsWith("/") ? pathAll : `${basePathParam}/${pathAll}`;

            const directoryArr = fullPath.split("/");
            const filename = directoryArr.pop();
            const basePath = directoryArr.join("/");

            let remoteTroubleShootMDSrc = "";
            try {
                remoteTroubleShootMDSrc = await request(`${rawRepoURI}${basePath}/${filename}`);
            } catch (ex) {
                const err = LiveSyncError.fromError(ex);
                remoteTroubleShootMDSrc = `${$msg("obsidianLiveSyncSettingTab.logErrorOccurred")}\n${err.toString()}`;
            }
            if (pageDisposed) return;
            const remoteTroubleShootMD = remoteTroubleShootMDSrc.replace(
                /\((.*?(.png)|(.jpg))\)/g,
                `(${rawRepoURI}${basePath}/$1)`
            );
            await MarkdownRenderer.render(
                this.plugin.app,
                `<a class='sls-troubleshoot-anchor'></a> [${$msg("obsidianLiveSyncSettingTab.linkTipsAndTroubleshooting")}](${topPath}) [${$msg("obsidianLiveSyncSettingTab.linkPageTop")}](${filename})\n\n${remoteTroubleShootMD}`,
                troubleShootEl,
                `${rawRepoURI}`,
                lifetimeComponent
            );
            if (pageDisposed) return;
            troubleShootEl.querySelector<HTMLAnchorElement>(".sls-troubleshoot-anchor")?.parentElement?.setCssStyles({
                position: "sticky",
                top: "-1em",
                backgroundColor: "var(--modal-background)",
            });
            troubleShootEl.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((anchorEl) => {
                anchorEl.addEventListener("click", (evt) => {
                    fireAndForget(async () => {
                        const uri = anchorEl.getAttr("data-href");
                        if (!uri) return;
                        if (uri.startsWith("#")) {
                            evt.preventDefault();
                            const elements = Array.from(
                                troubleShootEl.querySelectorAll<HTMLHeadingElement>("[data-heading]")
                            );
                            const target = elements.find(
                                (element) =>
                                    element.getAttr("data-heading")?.toLowerCase().split(" ").join("-") ===
                                    uri.substring(1).toLowerCase()
                            );
                            if (target) {
                                target.setCssStyles({ scrollMargin: "3em" });
                                target.scrollIntoView({
                                    behavior: "instant",
                                    block: "start",
                                });
                            }
                        } else {
                            evt.preventDefault();
                            await loadMarkdownPage(uri, basePath);
                            troubleShootEl.setCssStyles({ scrollMargin: "1em" });
                            troubleShootEl.scrollIntoView({
                                behavior: "instant",
                                block: "start",
                            });
                        }
                    });
                });
            });
            troubleShootEl.setCssStyles({ minHeight: "" });
        };
        void loadMarkdownPage(topPath);
    });
}
