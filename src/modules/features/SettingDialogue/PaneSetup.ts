import { MarkdownRenderer } from "../../../deps.ts";
import { $msg } from "../../../lib/src/common/i18n.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { fireAndForget } from "octagonal-wheels/promises";
import {
    EVENT_REQUEST_COPY_SETUP_URI,
    EVENT_REQUEST_OPEN_SETUP_URI,
    EVENT_REQUEST_SHOW_SETUP_QR,
    eventHub,
} from "../../../common/events.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
import { DEFAULT_SETTINGS } from "../../../lib/src/common/types.ts";
import { request } from "obsidian";
export function paneSetup(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel, addPane }: PageFunctions
): void {
    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleQuickSetup")).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameConnectSetupURI"))
            .setDesc($msg("obsidianLiveSyncSettingTab.descConnectSetupURI"))
            .addButton((text) => {
                text.setButtonText($msg("obsidianLiveSyncSettingTab.btnUse")).onClick(() => {
                    this.closeSetting();
                    eventHub.emitEvent(EVENT_REQUEST_OPEN_SETUP_URI);
                });
            });

        new Setting(paneEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameManualSetup"))
            .setDesc($msg("obsidianLiveSyncSettingTab.descManualSetup"))
            .addButton((text) => {
                text.setButtonText($msg("obsidianLiveSyncSettingTab.btnStart")).onClick(async () => {
                    await this.enableMinimalSetup();
                });
            });

        new Setting(paneEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameEnableLiveSync"))
            .setDesc($msg("obsidianLiveSyncSettingTab.descEnableLiveSync"))
            .addOnUpdate(visibleOnly(() => !this.isConfiguredAs("isConfigured", true)))
            .addButton((text) => {
                text.setButtonText($msg("obsidianLiveSyncSettingTab.btnEnable")).onClick(async () => {
                    this.editingSettings.isConfigured = true;
                    await this.saveAllDirtySettings();
                    this.services.appLifecycle.askRestart();
                });
            });
    });

    void addPanel(
        paneEl,
        $msg("obsidianLiveSyncSettingTab.titleSetupOtherDevices"),
        undefined,
        visibleOnly(() => this.isConfiguredAs("isConfigured", true))
    ).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameCopySetupURI"))
            .setDesc($msg("obsidianLiveSyncSettingTab.descCopySetupURI"))
            .addButton((text) => {
                text.setButtonText($msg("obsidianLiveSyncSettingTab.btnCopy")).onClick(() => {
                    // await this.plugin.addOnSetup.command_copySetupURI();
                    eventHub.emitEvent(EVENT_REQUEST_COPY_SETUP_URI);
                });
            });
        new Setting(paneEl)
            .setName($msg("Setup.ShowQRCode"))
            .setDesc($msg("Setup.ShowQRCode.Desc"))
            .addButton((text) => {
                text.setButtonText($msg("Setup.ShowQRCode")).onClick(() => {
                    eventHub.emitEvent(EVENT_REQUEST_SHOW_SETUP_QR);
                });
            });
    });

    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleReset")).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameDiscardSettings"))
            .addButton((text) => {
                text.setButtonText($msg("obsidianLiveSyncSettingTab.btnDiscard"))
                    .onClick(async () => {
                        if (
                            (await this.plugin.confirm.askYesNoDialog(
                                $msg("obsidianLiveSyncSettingTab.msgDiscardConfirmation"),
                                { defaultOption: "No" }
                            )) == "yes"
                        ) {
                            this.editingSettings = { ...this.editingSettings, ...DEFAULT_SETTINGS };
                            await this.saveAllDirtySettings();
                            this.plugin.settings = { ...DEFAULT_SETTINGS };
                            await this.services.setting.saveSettingData();
                            await this.services.database.resetDatabase();
                            // await this.plugin.initializeDatabase();
                            this.services.appLifecycle.askRestart();
                        }
                    })
                    .setWarning();
            })
            .addOnUpdate(visibleOnly(() => this.isConfiguredAs("isConfigured", true)));
    });

    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleExtraFeatures")).then((paneEl) => {
        new Setting(paneEl).autoWireToggle("useAdvancedMode");

        new Setting(paneEl).autoWireToggle("usePowerUserMode");
        new Setting(paneEl).autoWireToggle("useEdgeCaseMode");

        this.addOnSaved("useAdvancedMode", () => this.display());
        this.addOnSaved("usePowerUserMode", () => this.display());
        this.addOnSaved("useEdgeCaseMode", () => this.display());
    });

    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleOnlineTips")).then((paneEl) => {
        // this.createEl(paneEl, "h3", { text: $msg("obsidianLiveSyncSettingTab.titleOnlineTips") });
        const repo = "vrtmrz/obsidian-livesync";
        const topPath = $msg("obsidianLiveSyncSettingTab.linkTroubleshooting");
        const rawRepoURI = `https://raw.githubusercontent.com/${repo}/main`;
        this.createEl(
            paneEl,
            "div",
            "",
            (el) =>
                (el.innerHTML = `<a href='https://github.com/${repo}/blob/main${topPath}' target="_blank">${$msg("obsidianLiveSyncSettingTab.linkOpenInBrowser")}</a>`)
        );
        const troubleShootEl = this.createEl(paneEl, "div", {
            text: "",
            cls: "sls-troubleshoot-preview",
        });
        const loadMarkdownPage = async (pathAll: string, basePathParam: string = "") => {
            troubleShootEl.style.minHeight = troubleShootEl.clientHeight + "px";
            troubleShootEl.empty();
            const fullPath = pathAll.startsWith("/") ? pathAll : `${basePathParam}/${pathAll}`;

            const directoryArr = fullPath.split("/");
            const filename = directoryArr.pop();
            const directly = directoryArr.join("/");
            const basePath = directly;

            let remoteTroubleShootMDSrc = "";
            try {
                remoteTroubleShootMDSrc = await request(`${rawRepoURI}${basePath}/${filename}`);
            } catch (ex: any) {
                remoteTroubleShootMDSrc = `${$msg("obsidianLiveSyncSettingTab.logErrorOccurred")}\n${ex.toString()}`;
            }
            const remoteTroubleShootMD = remoteTroubleShootMDSrc.replace(
                /\((.*?(.png)|(.jpg))\)/g,
                `(${rawRepoURI}${basePath}/$1)`
            );
            // Render markdown
            await MarkdownRenderer.render(
                this.plugin.app,
                `<a class='sls-troubleshoot-anchor'></a> [${$msg("obsidianLiveSyncSettingTab.linkTipsAndTroubleshooting")}](${topPath}) [${$msg("obsidianLiveSyncSettingTab.linkPageTop")}](${filename})\n\n${remoteTroubleShootMD}`,
                troubleShootEl,
                `${rawRepoURI}`,
                this.plugin
            );
            // Menu
            troubleShootEl.querySelector<HTMLAnchorElement>(".sls-troubleshoot-anchor")?.parentElement?.setCssStyles({
                position: "sticky",
                top: "-1em",
                backgroundColor: "var(--modal-background)",
            });
            // Trap internal links.
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
                            const p = elements.find(
                                (e) =>
                                    e.getAttr("data-heading")?.toLowerCase().split(" ").join("-") ==
                                    uri.substring(1).toLowerCase()
                            );
                            if (p) {
                                p.setCssStyles({ scrollMargin: "3em" });
                                p.scrollIntoView({
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
            troubleShootEl.style.minHeight = "";
        };
        void loadMarkdownPage(topPath);
    });
}
