import { computed, reactive, reactiveSource, type ReactiveValue } from "octagonal-wheels/dataobject/reactive";
import type { DatabaseConnectingStatus, EntryDoc } from "../lib/src/common/types";
import { LiveSyncCommands } from "./LiveSyncCommands";
import { scheduleTask } from "octagonal-wheels/concurrency/task";
import { isDirty, throttle } from "../lib/src/common/utils";
import { collectingChunks, pluginScanningCount, hiddenFilesEventCount, hiddenFilesProcessingCount } from "../lib/src/mock_and_interop/stores";
import { eventHub } from "../lib/src/hub/hub";
import { EVENT_FILE_RENAMED, EVENT_LAYOUT_READY, EVENT_LEAF_ACTIVE_CHANGED } from "../common/events";

export class LogAddOn extends LiveSyncCommands {

    statusBar?: HTMLElement;

    statusDiv?: HTMLElement;
    statusLine?: HTMLDivElement;
    logMessage?: HTMLDivElement;
    logHistory?: HTMLDivElement;
    messageArea?: HTMLDivElement;

    statusBarLabels!: ReactiveValue<{ message: string, status: string }>;

    observeForLogs() {
        const padSpaces = `\u{2007}`.repeat(10);
        // const emptyMark = `\u{2003}`;
        function padLeftSpComputed(numI: ReactiveValue<number>, mark: string) {
            const formatted = reactiveSource("");
            let timer: ReturnType<typeof setTimeout> | undefined = undefined;
            let maxLen = 1;
            numI.onChanged(numX => {
                const num = numX.value;
                const numLen = `${Math.abs(num)}`.length + 1;
                maxLen = maxLen < numLen ? numLen : maxLen;
                if (timer) clearTimeout(timer);
                if (num == 0) {
                    timer = setTimeout(() => {
                        formatted.value = "";
                        maxLen = 1;
                    }, 3000);
                }
                formatted.value = ` ${mark}${`${padSpaces}${num}`.slice(-(maxLen))}`;
            })
            return computed(() => formatted.value);
        }
        const labelReplication = padLeftSpComputed(this.plugin.replicationResultCount, `📥`);
        const labelDBCount = padLeftSpComputed(this.plugin.databaseQueueCount, `📄`);
        const labelStorageCount = padLeftSpComputed(this.plugin.storageApplyingCount, `💾`);
        const labelChunkCount = padLeftSpComputed(collectingChunks, `🧩`);
        const labelPluginScanCount = padLeftSpComputed(pluginScanningCount, `🔌`);
        const labelConflictProcessCount = padLeftSpComputed(this.plugin.conflictProcessQueueCount, `🔩`);
        const hiddenFilesCount = reactive(() => hiddenFilesEventCount.value + hiddenFilesProcessingCount.value);
        const labelHiddenFilesCount = padLeftSpComputed(hiddenFilesCount, `⚙️`)
        const queueCountLabelX = reactive(() => {
            return `${labelReplication()}${labelDBCount()}${labelStorageCount()}${labelChunkCount()}${labelPluginScanCount()}${labelHiddenFilesCount()}${labelConflictProcessCount()}`;
        })
        const queueCountLabel = () => queueCountLabelX.value;

        const requestingStatLabel = computed(() => {
            const diff = this.plugin.requestCount.value - this.plugin.responseCount.value;
            return diff != 0 ? "📲 " : "";
        })

        const replicationStatLabel = computed(() => {
            const e = this.plugin.replicationStat.value;
            const sent = e.sent;
            const arrived = e.arrived;
            const maxPullSeq = e.maxPullSeq;
            const maxPushSeq = e.maxPushSeq;
            const lastSyncPullSeq = e.lastSyncPullSeq;
            const lastSyncPushSeq = e.lastSyncPushSeq;
            let pushLast = "";
            let pullLast = "";
            let w = "";
            const labels: Partial<Record<DatabaseConnectingStatus, string>> = {
                "CONNECTED": "⚡",
                "JOURNAL_SEND": "📦↑",
                "JOURNAL_RECEIVE": "📦↓",
            }
            switch (e.syncStatus) {
                case "CLOSED":
                case "COMPLETED":
                case "NOT_CONNECTED":
                    w = "⏹";
                    break;
                case "STARTED":
                    w = "🌀";
                    break;
                case "PAUSED":
                    w = "💤";
                    break;
                case "CONNECTED":
                case "JOURNAL_SEND":
                case "JOURNAL_RECEIVE":
                    w = labels[e.syncStatus] || "⚡";
                    pushLast = ((lastSyncPushSeq == 0) ? "" : (lastSyncPushSeq >= maxPushSeq ? " (LIVE)" : ` (${maxPushSeq - lastSyncPushSeq})`));
                    pullLast = ((lastSyncPullSeq == 0) ? "" : (lastSyncPullSeq >= maxPullSeq ? " (LIVE)" : ` (${maxPullSeq - lastSyncPullSeq})`));
                    break;
                case "ERRORED":
                    w = "⚠";
                    break;
                default:
                    w = "?";
            }
            return { w, sent, pushLast, arrived, pullLast };
        })
        const labelProc = padLeftSpComputed(this.plugin.vaultManager.processing, `⏳`);
        const labelPend = padLeftSpComputed(this.plugin.vaultManager.totalQueued, `🛫`);
        const labelInBatchDelay = padLeftSpComputed(this.plugin.vaultManager.batched, `📬`);
        const waitingLabel = computed(() => {
            return `${labelProc()}${labelPend()}${labelInBatchDelay()}`;
        })
        const statusLineLabel = computed(() => {
            const { w, sent, pushLast, arrived, pullLast } = replicationStatLabel();
            const queued = queueCountLabel();
            const waiting = waitingLabel();
            const networkActivity = requestingStatLabel();
            return {
                message: `${networkActivity}Sync: ${w} ↑ ${sent}${pushLast} ↓ ${arrived}${pullLast}${waiting}${queued}`,
            };
        })
        const statusBarLabels = reactive(() => {
            const scheduleMessage = this.plugin.isReloadingScheduled ? `WARNING! RESTARTING OBSIDIAN IS SCHEDULED!\n` : "";
            const { message } = statusLineLabel();
            const status = scheduleMessage + this.plugin.statusLog.value;

            return {
                message, status
            }
        })
        this.statusBarLabels = statusBarLabels;

        const applyToDisplay = throttle((label: typeof statusBarLabels.value) => {
            // const v = label;
            this.applyStatusBarText();

        }, 20);
        statusBarLabels.onChanged(label => applyToDisplay(label.value))
    }

    adjustStatusDivPosition() {
        const mdv = this.app.workspace.getMostRecentLeaf();
        if (mdv && this.statusDiv) {
            this.statusDiv.remove();
            // this.statusDiv.pa();
            const container = mdv.view.containerEl;
            container.insertBefore(this.statusDiv, container.lastChild);
        }
    }

    onunload() {
        if (this.statusDiv) {
            this.statusDiv.remove();
        }
        document.querySelectorAll(`.livesync-status`)?.forEach(e => e.remove());
    }
    async setFileStatus() {
        this.messageArea!.innerText = await this.plugin.getActiveFileStatus();
    }
    onActiveLeafChange() {
        this.adjustStatusDivPosition();
        this.setFileStatus();

    }
    onload(): void | Promise<void> {
        eventHub.onEvent(EVENT_FILE_RENAMED, (evt: CustomEvent<{ oldPath: string, newPath: string }>) => {
            this.setFileStatus();
        });
        eventHub.onEvent(EVENT_LEAF_ACTIVE_CHANGED, () => this.onActiveLeafChange());
        const w = document.querySelectorAll(`.livesync-status`);
        w.forEach(e => e.remove());

        this.observeForLogs();
        this.adjustStatusDivPosition();
        this.statusDiv = this.app.workspace.containerEl.createDiv({ cls: "livesync-status" });
        this.statusLine = this.statusDiv.createDiv({ cls: "livesync-status-statusline" });
        this.messageArea = this.statusDiv.createDiv({ cls: "livesync-status-messagearea" });
        this.logMessage = this.statusDiv.createDiv({ cls: "livesync-status-logmessage" });
        this.logHistory = this.statusDiv.createDiv({ cls: "livesync-status-loghistory" });
        eventHub.onEvent(EVENT_LAYOUT_READY, () => this.adjustStatusDivPosition());
        if (this.settings.showStatusOnStatusbar) {
            this.statusBar = this.plugin.addStatusBarItem();
            this.statusBar.addClass("syncstatusbar");
        }
    }
    nextFrameQueue: ReturnType<typeof requestAnimationFrame> | undefined = undefined;
    logLines: { ttl: number, message: string }[] = [];

    applyStatusBarText() {
        if (this.nextFrameQueue) {
            return;
        }
        this.nextFrameQueue = requestAnimationFrame(() => {
            this.nextFrameQueue = undefined;
            const { message, status } = this.statusBarLabels.value;
            // const recent = logMessages.value;
            const newMsg = message;
            const newLog = this.settings.showOnlyIconsOnEditor ? "" : status;

            this.statusBar?.setText(newMsg.split("\n")[0]);
            if (this.settings.showStatusOnEditor && this.statusDiv) {
                // const root = activeDocument.documentElement;
                // root.style.setProperty("--sls-log-text", "'" + (newMsg + "\\A " + newLog) + "'");
                // this.statusDiv.innerText = newMsg + "\\A " + newLog;
                if (this.settings.showLongerLogInsideEditor) {
                    const now = new Date().getTime();
                    this.logLines = this.logLines.filter(e => e.ttl > now);
                    const minimumNext = this.logLines.reduce((a, b) => a < b.ttl ? a : b.ttl, Number.MAX_SAFE_INTEGER);
                    if (this.logLines.length > 0) setTimeout(() => this.applyStatusBarText(), minimumNext - now);
                    const recent = this.logLines.map(e => e.message);
                    const recentLogs = recent.reverse().join("\n");
                    if (isDirty("recentLogs", recentLogs)) this.logHistory!.innerText = recentLogs;
                }
                if (isDirty("newMsg", newMsg)) this.statusLine!.innerText = newMsg;
                if (isDirty("newLog", newLog)) this.logMessage!.innerText = newLog;
            } else {
                // const root = activeDocument.documentElement;
                // root.style.setProperty("--log-text", "'" + (newMsg + "\\A " + newLog) + "'");
            }
        });

        scheduleTask("log-hide", 3000, () => { this.plugin.statusLog.value = "" });
    }


    onInitializeDatabase(showNotice: boolean) { }
    beforeReplicate(showNotice: boolean) { }
    onResume() { }
    parseReplicationResultItem(docs: PouchDB.Core.ExistingDocument<EntryDoc>): boolean | Promise<boolean> {
        return false;
    }
    async realizeSettingSyncMode() { }


}

