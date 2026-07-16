import { MarkdownRenderer } from "@/deps.ts";
import { $msg } from "@lib/common/i18n.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { fireAndForget } from "octagonal-wheels/promises";
import {
    EVENT_REQUEST_COPY_SETUP_URI,
    EVENT_REQUEST_OPEN_SETUP_URI,
    EVENT_REQUEST_SHOW_SETUP_QR,
    eventHub,
} from "@/common/events.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
import { DEFAULT_SETTINGS } from "@lib/common/types.ts";
import { request } from "@/deps.ts";
import { SetupManager, UserMode } from "@/modules/features/SetupManager.ts";
import { LiveSyncError } from "@lib/common/LSError.ts";
export function paneSetup(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel, addPane }: PageFunctions
): void {
    void addPanel(paneEl, $msg("Quick Setup")).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("Connect with Setup URI"))
            .setDesc($msg("This is the recommended method to set up Self-hosted LiveSync with a Setup URI."))
            .addButton((text) => {
                text.setButtonText($msg("obsidianLiveSyncSettingTab.btnUse")).onClick(() => {
                    this.closeSetting();
                    eventHub.emitEvent(EVENT_REQUEST_OPEN_SETUP_URI);
                });
            });

        new Setting(paneEl)
            .setName($msg("Rerun Onboarding Wizard"))
            .setDesc($msg("Rerun the onboarding wizard to set up Self-hosted LiveSync again."))
            .addButton((text) => {
                text.setButtonText($msg("Rerun Wizard")).onClick(async () => {
                    const setupManager = this.core.getModule(SetupManager);
                    await setupManager.onOnboard(UserMode.ExistingUser);
                    // await this.plugin.moduleSetupObsidian.onBoardingWizard(true);
                });
            });

        new Setting(paneEl)
            .setName($msg("Enable LiveSync"))
            .setDesc($msg("Only enable this after configuring either of the above two options or completing all configuration manually."))
            .addOnUpdate(visibleOnly(() => !this.isConfiguredAs("isConfigured", true)))
            .addButton((text) => {
                text.setButtonText($msg("Enable")).onClick(async () => {
                    this.editingSettings.isConfigured = true;
                    await this.saveAllDirtySettings();
                    this.services.appLifecycle.askRestart();
                });
            });
    });

    void addPanel(
        paneEl,
        $msg("To setup other devices"),
        undefined,
        visibleOnly(() => this.isConfiguredAs("isConfigured", true))
    ).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("Copy the current settings to a Setup URI"))
            .setDesc($msg("Perfect for setting up a new device!"))
            .addButton((text) => {
                text.setButtonText($msg("obsidianLiveSyncSettingTab.btnCopy")).onClick(() => {
                    // await this.plugin.addOnSetup.command_copySetupURI();
                    eventHub.emitEvent(EVENT_REQUEST_COPY_SETUP_URI);
                });
            });
        new Setting(paneEl)
            .setName($msg("Show QR code"))
            .setDesc($msg("Show QR code to transfer the settings."))
            .addButton((text) => {
                text.setButtonText($msg("Show QR code")).onClick(() => {
                    eventHub.emitEvent(EVENT_REQUEST_SHOW_SETUP_QR);
                });
            });
    });

    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleReset")).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("Discard existing settings and databases"))
            .addButton((text) => {
                text.setButtonText($msg("Discard"))
                    .onClick(async () => {
                        if (
                            (await this.core.confirm.askYesNoDialog(
                                $msg("Do you really want to discard existing settings and databases?"),
                                { defaultOption: "No" }
                            )) == "yes"
                        ) {
                            this.editingSettings = { ...this.editingSettings, ...DEFAULT_SETTINGS };
                            await this.saveAllDirtySettings();
                            this.core.settings = { ...DEFAULT_SETTINGS };
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

    void addPanel(paneEl, $msg("Enable extra and advanced features")).then((paneEl) => {
        new Setting(paneEl).autoWireToggle("useAdvancedMode");

        new Setting(paneEl).autoWireToggle("usePowerUserMode");
        new Setting(paneEl).autoWireToggle("useEdgeCaseMode");

        this.addOnSaved("useAdvancedMode", () => this.display());
        this.addOnSaved("usePowerUserMode", () => this.display());
        this.addOnSaved("useEdgeCaseMode", () => this.display());
    });

    void addPanel(paneEl, $msg("Online Tips")).then((paneEl) => {
        // this.createEl(paneEl, "h3", { text: $msg("Online Tips") });
        const repo = "vrtmrz/obsidian-livesync";
        const topPath = $msg("obsidianLiveSyncSettingTab.linkTroubleshooting");
        const rawRepoURI = `https://raw.githubusercontent.com/${repo}/main`;
        this.createEl(paneEl, "div", "", (el) => {
            el.createEl("a", { text: $msg("Open in browser") }, (anchor) => {
                anchor.href = `https://github.com/${repo}/blob/main${topPath}`;
                anchor.target = "_blank";
                anchor.rel = "noopener";
            });
        });
        const troubleShootEl = this.createEl(paneEl, "div", {
            text: "",
            cls: "sls-troubleshoot-preview",
        });
        const loadMarkdownPage = async (pathAll: string, basePathParam: string = "") => {
            troubleShootEl.setCssStyles({ minHeight: troubleShootEl.clientHeight + "px" });
            troubleShootEl.empty();
            const fullPath = pathAll.startsWith("/") ? pathAll : `${basePathParam}/${pathAll}`;

            const directoryArr = fullPath.split("/");
            const filename = directoryArr.pop();
            const directly = directoryArr.join("/");
            const basePath = directly;

            let remoteTroubleShootMDSrc = "";
            try {
                remoteTroubleShootMDSrc = await request(`${rawRepoURI}${basePath}/${filename}`);
            } catch (ex) {
                const err = LiveSyncError.fromError(ex);
                remoteTroubleShootMDSrc = `${$msg("An error occurred!!")}\n${err.toString()}`;
            }
            const remoteTroubleShootMD = remoteTroubleShootMDSrc.replace(
                /\((.*?(.png)|(.jpg))\)/g,
                `(${rawRepoURI}${basePath}/$1)`
            );
            // Render markdown
            await MarkdownRenderer.render(
                this.plugin.app,
                `<a class='sls-troubleshoot-anchor'></a> [${$msg("Tips and Troubleshooting")}](${topPath}) [${$msg("Page Top")}](${filename})\n\n${remoteTroubleShootMD}`,
                troubleShootEl,
                `${rawRepoURI}`,
                this.lifetimeComponent
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
            troubleShootEl.setCssStyles({ minHeight: "" });
        };
        void loadMarkdownPage(topPath);
    });
}
