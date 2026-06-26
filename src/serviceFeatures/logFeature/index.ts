import { createObsidianServiceFeature } from "@/types.ts";
import { setGlobalLogFunction } from "octagonal-wheels/common/logger";
import { LiveSyncError } from "@lib/common/LSError.ts";
import type { LogEntry } from "@lib/mock_and_interop/stores.ts";
import {
    EVENT_FILE_RENAMED,
    EVENT_LAYOUT_READY,
    EVENT_LEAF_ACTIVE_CHANGED,
    EVENT_ON_UNRESOLVED_ERROR,
    eventHub,
} from "@/common/events.ts";
import { addIcon, Notice, stringifyYaml, type WorkspaceLeaf } from "@/deps.ts";
import { $msg } from "@lib/common/i18n.ts";
import { LOG_LEVEL_INFO, LOG_LEVEL_VERBOSE } from "@lib/common/types.ts";
import { LogPaneView, VIEW_TYPE_LOG } from "@/modules/features/Log/LogPaneView.ts";
import { generateReport } from "@/common/reportTool.ts";
import { compatGlobal } from "@lib/common/coreEnvFunctions.ts";

import type { LogFeatureServices, LogFeatureModules } from "./types.ts";
import { createInitialState, type LogFeatureState } from "./state.ts";
import {
    processAddLog,
    setFileStatus,
    observeForLogs,
    adjustStatusDivPosition,
    onActiveLeafChange,
    updateMessageArea,
    redactLog,
} from "./logOperations.ts";

let activeState: LogFeatureState | null = null;

const globalLogFunction = (message: unknown, level?: number, key?: string) => {
    const messageX =
        message instanceof Error
            ? new LiveSyncError("[Error Logged]: " + message.message, { cause: message })
            : typeof message === "string"
              ? message
              : JSON.stringify(message);
    const entry = { message: messageX, level, key } as LogEntry;
    if (activeState) {
        activeState.recentLogEntries.value = [...activeState.recentLogEntries.value, entry];
    }
};

// Intercept global logger calls
setGlobalLogFunction(globalLogFunction);

/**
 * A service feature hook that initialises and manages logging, status display, and debug report generation.
 */
export const useLogFeature = createObsidianServiceFeature<
    LogFeatureServices,
    LogFeatureModules,
    "app" | "liveSyncPlugin",
    void
>((host) => {
    const state = createInitialState();
    activeState = state;

    const everyOnloadStart = (): Promise<boolean> => {
        addIcon(
            "view-log",
            `<g transform="matrix(1.28 0 0 1.28 -131 -411)" fill="currentColor" fill-rule="evenodd">
        <path d="m103 330h76v12h-76z"/>
        <path d="m106 346v44h70v-44zm45 16h-20v-8h20z"/>
       </g>`
        );

        host.services.API.addRibbonIcon("view-log", $msg("moduleLog.showLog"), () => {
            void host.services.API.showWindow(VIEW_TYPE_LOG);
        }).addClass("livesync-ribbon-showlog");

        host.services.API.addCommand({
            id: "view-log",
            name: "Show log",
            callback: () => {
                void host.services.API.showWindow(VIEW_TYPE_LOG);
            },
        });

        host.services.API.addCommand({
            id: "dump-debug-info",
            name: "Generate full report for opening the issue with debug info",
            callback: async () => {
                const recentLog = [...state.logForDump];
                const report = await generateReport(host.services.setting.currentSettings(), host as any);
                const info = {
                    ...report,
                    recentLog: recentLog.map(redactLog),
                };
                const yaml = `\`\`\`\`\n# ---- Debug Info Dump ----\n${stringifyYaml(info)}\n\`\`\`\``;
                if (await host.services.UI.promptCopyToClipboard("Debug info", yaml)) {
                    new Notice(
                        "Debug info copied to clipboard. You can paste it in the issue. Be careful as it may contain sensitive information, review it before sharing."
                    );
                }
            },
        });

        const plugin = host.context.liveSyncPlugin;
        host.services.API.registerWindow(VIEW_TYPE_LOG, (leaf: WorkspaceLeaf) => new LogPaneView(leaf, plugin));
        return Promise.resolve(true);
    };

    const everyOnloadAfterLoadSettings = (): Promise<boolean> => {
        state.recentLogEntries.onChanged((entries) => {
            if (entries.value.length === 0) return;
            const newEntries = [...entries.value];
            state.recentLogEntries.value = [];
            newEntries.forEach((e) => processAddLog(host, state, e.message, e.level, e.key));
        });

        eventHub.onEvent(EVENT_FILE_RENAMED, () => {
            void setFileStatus(host, state);
        });

        const w = compatGlobal.document.querySelectorAll(`.livesync-status`);
        w.forEach((e) => e.remove());

        observeForLogs(host, state);

        const settings = host.services.setting.settings;
        const app = host.context.app;
        if (settings.showStatusOnEditor) {
            const div = app.workspace.containerEl.createDiv({ cls: "livesync-status" });
            state.statusDiv = div;
            state.statusLine = div.createDiv({ cls: "livesync-status-statusline" });
            state.messageArea = div.createDiv({ cls: "livesync-status-messagearea" });
            state.logMessage = div.createDiv({ cls: "livesync-status-logmessage" });
            state.logHistory = div.createDiv({ cls: "livesync-status-loghistory" });
            div.setCssStyles({ display: settings?.showStatusOnEditor ? "" : "none" });
        }

        eventHub.onEvent(EVENT_LAYOUT_READY, () => adjustStatusDivPosition(host, state));
        if (settings?.showStatusOnStatusbar) {
            state.statusBar = host.services.API.addStatusBarItem();
            state.statusBar?.addClass("syncstatusbar");
        }
        adjustStatusDivPosition(host, state);
        processAddLog(host, state, "Log module loaded", LOG_LEVEL_INFO);
        processAddLog(host, state, "Verbose log", LOG_LEVEL_VERBOSE);
        return Promise.resolve(true);
    };

    const everyOnload = (): Promise<boolean> => {
        eventHub.onEvent(EVENT_LEAF_ACTIVE_CHANGED, () => onActiveLeafChange(host, state));
        eventHub.onceEvent(EVENT_LAYOUT_READY, () => onActiveLeafChange(host, state));
        eventHub.onEvent(EVENT_ON_UNRESOLVED_ERROR, () => updateMessageArea(host, state));
        return Promise.resolve(true);
    };

    const allStartOnUnload = (): Promise<boolean> => {
        activeState = null;
        if (state.statusDiv) {
            state.statusDiv.remove();
        }
        compatGlobal.document.querySelectorAll(`.livesync-status`)?.forEach((e) => e.remove());
        return Promise.resolve(true);
    };

    // Bind handlers
    (host.services.API.addLog as any).setHandler(globalLogFunction);
    host.services.appLifecycle.onInitialise.addHandler(everyOnloadStart);
    host.services.appLifecycle.onSettingLoaded.addHandler(everyOnloadAfterLoadSettings);
    host.services.appLifecycle.onLoaded.addHandler(everyOnload);
    host.services.appLifecycle.onBeforeUnload.addHandler(allStartOnUnload);
});
