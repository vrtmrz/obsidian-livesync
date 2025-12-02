import { computed, reactive, reactiveSource, type ReactiveValue } from "octagonal-wheels/dataobject/reactive";
import {
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_INFO,
    LOG_LEVEL_VERBOSE,
    PREFIXMD_LOGFILE,
    type DatabaseConnectingStatus,
    type LOG_LEVEL,
} from "../../lib/src/common/types.ts";
import { cancelTask, scheduleTask } from "octagonal-wheels/concurrency/task";
import { fireAndForget, isDirty, throttle } from "../../lib/src/common/utils.ts";
import {
    collectingChunks,
    pluginScanningCount,
    hiddenFilesEventCount,
    hiddenFilesProcessingCount,
    type LogEntry,
    logStore,
    logMessages,
} from "../../lib/src/mock_and_interop/stores.ts";
import { eventHub } from "../../lib/src/hub/hub.ts";
import {
    EVENT_FILE_RENAMED,
    EVENT_LAYOUT_READY,
    EVENT_LEAF_ACTIVE_CHANGED,
    EVENT_ON_UNRESOLVED_ERROR,
} from "../../common/events.ts";
import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
import { addIcon, normalizePath, Notice } from "../../deps.ts";
import { LOG_LEVEL_NOTICE, setGlobalLogFunction } from "octagonal-wheels/common/logger";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import { LogPaneView, VIEW_TYPE_LOG } from "./Log/LogPaneView.ts";
import { serialized } from "octagonal-wheels/concurrency/lock";
import { $msg } from "src/lib/src/common/i18n.ts";
import { P2PLogCollector } from "../../lib/src/replication/trystero/P2PReplicatorCore.ts";
import type { LiveSyncCore } from "../../main.ts";
import { LiveSyncError } from "@/lib/src/common/LSError.ts";
import { isValidPath } from "@/common/utils.ts";
import {
    isValidFilenameInAndroid,
    isValidFilenameInDarwin,
    isValidFilenameInWidows,
} from "@/lib/src/string_and_binary/path.ts";

// This module cannot be a core module because it depends on the Obsidian UI.

// DI the log again.
setGlobalLogFunction((message: any, level?: number, key?: string) => {
    const messageX =
        message instanceof Error
            ? new LiveSyncError("[Error Logged]: " + message.message, { cause: message })
            : message;
    const entry = { message: messageX, level, key } as LogEntry;
    logStore.enqueue(entry);
});
let recentLogs = [] as string[];

// Recent log splicer
const recentLogProcessor = new QueueProcessor(
    (logs: string[]) => {
        recentLogs = [...recentLogs, ...logs].splice(-200);
        logMessages.value = recentLogs;
    },
    { batchSize: 25, delay: 10, suspended: false, concurrentLimit: 1 }
).resumePipeLine();
// logStore.intercept(e => e.slice(Math.min(e.length - 200, 0)));

const showDebugLog = false;
export const MARK_DONE = "\u{2009}\u{2009}";
export class ModuleLog extends AbstractObsidianModule {
    registerView = this.plugin.registerView.bind(this.plugin);

    statusBar?: HTMLElement;

    statusDiv?: HTMLElement;
    statusLine?: HTMLDivElement;
    logMessage?: HTMLDivElement;
    logHistory?: HTMLDivElement;
    messageArea?: HTMLDivElement;

    statusBarLabels!: ReactiveValue<{ message: string; status: string }>;
    statusLog = reactiveSource("");
    activeFileStatus = reactiveSource("");
    notifies: { [key: string]: { notice: Notice; count: number } } = {};
    p2pLogCollector = new P2PLogCollector();

    observeForLogs() {
        const padSpaces = `\u{2007}`.repeat(10);
        // const emptyMark = `\u{2003}`;
        function padLeftSpComputed(numI: ReactiveValue<number>, mark: string) {
            const formatted = reactiveSource("");
            let timer: ReturnType<typeof setTimeout> | undefined = undefined;
            let maxLen = 1;
            numI.onChanged((numX) => {
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
                formatted.value = ` ${mark}${`${padSpaces}${num}`.slice(-maxLen)}`;
            });
            return computed(() => formatted.value);
        }
        const labelReplication = padLeftSpComputed(this.core.replicationResultCount, `📥`);
        const labelDBCount = padLeftSpComputed(this.core.databaseQueueCount, `📄`);
        const labelStorageCount = padLeftSpComputed(this.core.storageApplyingCount, `💾`);
        const labelChunkCount = padLeftSpComputed(collectingChunks, `🧩`);
        const labelPluginScanCount = padLeftSpComputed(pluginScanningCount, `🔌`);
        const labelConflictProcessCount = padLeftSpComputed(this.core.conflictProcessQueueCount, `🔩`);
        const hiddenFilesCount = reactive(() => hiddenFilesEventCount.value - hiddenFilesProcessingCount.value);
        const labelHiddenFilesCount = padLeftSpComputed(hiddenFilesCount, `⚙️`);
        const queueCountLabelX = reactive(() => {
            return `${labelReplication()}${labelDBCount()}${labelStorageCount()}${labelChunkCount()}${labelPluginScanCount()}${labelHiddenFilesCount()}${labelConflictProcessCount()}`;
        });
        const queueCountLabel = () => queueCountLabelX.value;

        const requestingStatLabel = computed(() => {
            const diff = this.core.requestCount.value - this.core.responseCount.value;
            return diff != 0 ? "📲 " : "";
        });

        const replicationStatLabel = computed(() => {
            const e = this.core.replicationStat.value;
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
                CONNECTED: "⚡",
                JOURNAL_SEND: "📦↑",
                JOURNAL_RECEIVE: "📦↓",
            };
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
                    pushLast =
                        lastSyncPushSeq == 0
                            ? ""
                            : lastSyncPushSeq >= maxPushSeq
                              ? " (LIVE)"
                              : ` (${maxPushSeq - lastSyncPushSeq})`;
                    pullLast =
                        lastSyncPullSeq == 0
                            ? ""
                            : lastSyncPullSeq >= maxPullSeq
                              ? " (LIVE)"
                              : ` (${maxPullSeq - lastSyncPullSeq})`;
                    break;
                case "ERRORED":
                    w = "⚠";
                    break;
                default:
                    w = "?";
            }
            return { w, sent, pushLast, arrived, pullLast };
        });
        const labelProc = padLeftSpComputed(this.core.processing, `⏳`);
        const labelPend = padLeftSpComputed(this.core.totalQueued, `🛫`);
        const labelInBatchDelay = padLeftSpComputed(this.core.batched, `📬`);
        const waitingLabel = computed(() => {
            return `${labelProc()}${labelPend()}${labelInBatchDelay()}`;
        });
        const statusLineLabel = computed(() => {
            const { w, sent, pushLast, arrived, pullLast } = replicationStatLabel();
            const queued = queueCountLabel();
            const waiting = waitingLabel();
            const networkActivity = requestingStatLabel();
            const p2p = this.p2pLogCollector.p2pReplicationLine.value;
            return {
                message: `${networkActivity}Sync: ${w} ↑ ${sent}${pushLast} ↓ ${arrived}${pullLast}${waiting}${queued}${p2p == "" ? "" : "\n" + p2p}`,
            };
        });

        const statusBarLabels = reactive(() => {
            const scheduleMessage = this.services.appLifecycle.isReloadingScheduled()
                ? `WARNING! RESTARTING OBSIDIAN IS SCHEDULED!\n`
                : "";
            const { message } = statusLineLabel();
            const fileStatus = this.activeFileStatus.value;
            const status = scheduleMessage + this.statusLog.value;
            const fileStatusIcon = `${fileStatus && this.settings.hideFileWarningNotice ? " ⛔ SKIP" : ""}`;
            return {
                message: `${message}${fileStatusIcon}`,
                status,
            };
        });
        this.statusBarLabels = statusBarLabels;

        const applyToDisplay = throttle((label: typeof statusBarLabels.value) => {
            // const v = label;
            this.applyStatusBarText();
        }, 20);
        statusBarLabels.onChanged((label) => applyToDisplay(label.value));
        this.activeFileStatus.onChanged(() => this.updateMessageArea());
    }

    private _everyOnload(): Promise<boolean> {
        eventHub.onEvent(EVENT_LEAF_ACTIVE_CHANGED, () => this.onActiveLeafChange());
        eventHub.onceEvent(EVENT_LAYOUT_READY, () => this.onActiveLeafChange());
        eventHub.onEvent(EVENT_ON_UNRESOLVED_ERROR, () => this.updateMessageArea());

        return Promise.resolve(true);
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

    async getActiveFileStatus() {
        const reason = [] as string[];
        const reasonWarn = [] as string[];
        const thisFile = this.app.workspace.getActiveFile();
        if (!thisFile) return "";
        const validPath = isValidPath(thisFile.path);
        if (!validPath) {
            reason.push("This file has an invalid path under the current settings");
        } else {
            // The most narrow check: Filename validity on Windows
            const validOnWindows = isValidFilenameInWidows(thisFile.name);
            const validOnDarwin = isValidFilenameInDarwin(thisFile.name);
            const validOnAndroid = isValidFilenameInAndroid(thisFile.name);
            const labels = [];
            if (!validOnWindows) labels.push("🪟");
            if (!validOnDarwin) labels.push("🍎");
            if (!validOnAndroid) labels.push("🤖");
            if (labels.length > 0) {
                reasonWarn.push("Some platforms may be unable to process this file correctly: " + labels.join(" "));
            }
        }
        // Case Sensitivity
        if (this.services.setting.shouldCheckCaseInsensitively()) {
            const f = this.core.storageAccess
                .getFiles()
                .map((e) => e.path)
                .filter((e) => e.toLowerCase() == thisFile.path.toLowerCase());
            if (f.length > 1) {
                reason.push("There are multiple files with the same name (case-insensitive match)");
            }
        }
        if (!(await this.services.vault.isTargetFile(thisFile.path))) {
            reason.push("This file is ignored by the ignore rules");
        }
        if (this.services.vault.isFileSizeTooLarge(thisFile.stat.size)) {
            reason.push("This file size exceeds the configured limit");
        }
        const result = reason.length > 0 ? "Not synchronised: " + reason.join(", ") : "";
        const warnResult = reasonWarn.length > 0 ? "Warning: " + reasonWarn.join(", ") : "";
        return [result, warnResult].filter((e) => e).join("\n");
    }
    async setFileStatus() {
        const fileStatus = await this.getActiveFileStatus();
        this.activeFileStatus.value = fileStatus;
    }

    async updateMessageArea() {
        if (this.messageArea) {
            const messageLines = [];
            const fileStatus = this.activeFileStatus.value;
            if (fileStatus && !this.settings.hideFileWarningNotice) messageLines.push(fileStatus);
            const messages = (await this.services.appLifecycle.getUnresolvedMessages()).flat().filter((e) => e);
            messageLines.push(...messages);
            this.messageArea.innerText = messageLines.map((e) => `⚠️ ${e}`).join("\n");
        }
    }

    onActiveLeafChange() {
        fireAndForget(async () => {
            this.adjustStatusDivPosition();
            await this.setFileStatus();
        });
    }

    nextFrameQueue: ReturnType<typeof requestAnimationFrame> | undefined = undefined;
    logLines: { ttl: number; message: string }[] = [];

    applyStatusBarText() {
        if (this.nextFrameQueue) {
            return;
        }
        this.nextFrameQueue = requestAnimationFrame(() => {
            this.nextFrameQueue = undefined;
            const { message, status } = this.statusBarLabels.value;
            // const recent = logMessages.value;
            const newMsg = message;
            let newLog = this.settings?.showOnlyIconsOnEditor ? "" : status;
            const moduleTagEnd = newLog.indexOf(`]\u{200A}`);
            if (moduleTagEnd != -1) {
                newLog = newLog.substring(moduleTagEnd + 2);
            }

            this.statusBar?.setText(newMsg.split("\n")[0]);
            if (this.settings?.showStatusOnEditor && this.statusDiv) {
                if (this.settings.showLongerLogInsideEditor) {
                    const now = new Date().getTime();
                    this.logLines = this.logLines.filter((e) => e.ttl > now);
                    const minimumNext = this.logLines.reduce(
                        (a, b) => (a < b.ttl ? a : b.ttl),
                        Number.MAX_SAFE_INTEGER
                    );
                    if (this.logLines.length > 0) setTimeout(() => this.applyStatusBarText(), minimumNext - now);
                    const recent = this.logLines.map((e) => e.message);
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

        scheduleTask("log-hide", 3000, () => {
            this.statusLog.value = "";
        });
    }

    private _allStartOnUnload(): Promise<boolean> {
        if (this.statusDiv) {
            this.statusDiv.remove();
        }
        document.querySelectorAll(`.livesync-status`)?.forEach((e) => e.remove());
        return Promise.resolve(true);
    }
    _everyOnloadStart(): Promise<boolean> {
        addIcon(
            "view-log",
            `<g transform="matrix(1.28 0 0 1.28 -131 -411)" fill="currentColor" fill-rule="evenodd">
        <path d="m103 330h76v12h-76z"/>
        <path d="m106 346v44h70v-44zm45 16h-20v-8h20z"/>
       </g>`
        );
        this.addRibbonIcon("view-log", $msg("moduleLog.showLog"), () => {
            void this.services.API.showWindow(VIEW_TYPE_LOG);
        }).addClass("livesync-ribbon-showlog");

        this.addCommand({
            id: "view-log",
            name: "Show log",
            callback: () => {
                void this.services.API.showWindow(VIEW_TYPE_LOG);
            },
        });
        this.registerView(VIEW_TYPE_LOG, (leaf) => new LogPaneView(leaf, this.plugin));
        return Promise.resolve(true);
    }
    private _everyOnloadAfterLoadSettings(): Promise<boolean> {
        logStore
            .pipeTo(
                new QueueProcessor((logs) => logs.forEach((e) => this.__addLog(e.message, e.level, e.key)), {
                    suspended: false,
                    batchSize: 20,
                    concurrentLimit: 1,
                    delay: 0,
                })
            )
            .startPipeline();
        eventHub.onEvent(EVENT_FILE_RENAMED, (data) => {
            void this.setFileStatus();
        });

        const w = document.querySelectorAll(`.livesync-status`);
        w.forEach((e) => e.remove());

        this.observeForLogs();

        this.statusDiv = this.app.workspace.containerEl.createDiv({ cls: "livesync-status" });
        this.statusLine = this.statusDiv.createDiv({ cls: "livesync-status-statusline" });
        this.messageArea = this.statusDiv.createDiv({ cls: "livesync-status-messagearea" });
        this.logMessage = this.statusDiv.createDiv({ cls: "livesync-status-logmessage" });
        this.logHistory = this.statusDiv.createDiv({ cls: "livesync-status-loghistory" });
        eventHub.onEvent(EVENT_LAYOUT_READY, () => this.adjustStatusDivPosition());
        if (this.settings?.showStatusOnStatusbar) {
            this.statusBar = this.core.addStatusBarItem();
            this.statusBar.addClass("syncstatusbar");
        }
        this.adjustStatusDivPosition();
        return Promise.resolve(true);
    }

    writeLogToTheFile(now: Date, vaultName: string, newMessage: string) {
        fireAndForget(() =>
            serialized("writeLog", async () => {
                const time = now.toISOString().split("T")[0];
                const logDate = `${PREFIXMD_LOGFILE}${time}.md`;
                const file = await this.core.storageAccess.isExists(normalizePath(logDate));
                if (!file) {
                    await this.core.storageAccess.appendHiddenFile(normalizePath(logDate), "```\n");
                }
                await this.core.storageAccess.appendHiddenFile(
                    normalizePath(logDate),
                    vaultName + ":" + newMessage + "\n"
                );
            })
        );
    }
    __addLog(message: any, level: LOG_LEVEL = LOG_LEVEL_INFO, key = ""): void {
        if (level == LOG_LEVEL_DEBUG && !showDebugLog) {
            return;
        }
        if (level <= LOG_LEVEL_INFO && this.settings && this.settings.lessInformationInLog) {
            return;
        }
        if (this.settings && !this.settings.showVerboseLog && level == LOG_LEVEL_VERBOSE) {
            return;
        }
        const vaultName = this.services.vault.getVaultName();
        const now = new Date();
        const timestamp = now.toLocaleString();
        let errorInfo = "";
        if (message instanceof Error) {
            if (message instanceof LiveSyncError) {
                errorInfo = `${message.cause?.name}:${message.cause?.message}\n[StackTrace]: ${message.stack}\n[CausedBy]: ${message.cause?.stack}`;
            } else {
                const thisStack = new Error().stack;
                errorInfo = `${message.name}:${message.message}\n[StackTrace]: ${message.stack}\n[LogCallStack]: ${thisStack}`;
            }
        }
        const messageContent =
            typeof message == "string"
                ? message
                : message instanceof Error
                  ? `${errorInfo}`
                  : JSON.stringify(message, null, 2);
        const newMessage = timestamp + "->" + messageContent;
        if (message instanceof Error) {
            console.error(vaultName + ":" + newMessage);
        } else if (level >= LOG_LEVEL_INFO) {
            console.log(vaultName + ":" + newMessage);
        } else {
            console.debug(vaultName + ":" + newMessage);
        }
        if (!this.settings?.showOnlyIconsOnEditor) {
            this.statusLog.value = messageContent;
        }
        if (this.settings?.writeLogToTheFile) {
            this.writeLogToTheFile(now, vaultName, newMessage);
        }
        recentLogProcessor.enqueue(newMessage);
        this.logLines.push({ ttl: now.getTime() + 3000, message: newMessage });

        if (level >= LOG_LEVEL_NOTICE) {
            if (!key) key = messageContent;
            if (key in this.notifies) {
                // @ts-ignore
                const isShown = this.notifies[key].notice.noticeEl?.isShown();
                if (!isShown) {
                    this.notifies[key].notice = new Notice(messageContent, 0);
                }
                cancelTask(`notify-${key}`);
                if (key == messageContent) {
                    this.notifies[key].count++;
                    this.notifies[key].notice.setMessage(`(${this.notifies[key].count}):${messageContent}`);
                } else {
                    this.notifies[key].notice.setMessage(`${messageContent}`);
                }
            } else {
                const notify = new Notice(messageContent, 0);
                this.notifies[key] = {
                    count: 0,
                    notice: notify,
                };
            }
            const timeout = 5000;
            if (!key.startsWith("keepalive-") || messageContent.indexOf(MARK_DONE) !== -1) {
                scheduleTask(`notify-${key}`, timeout, () => {
                    const notify = this.notifies[key].notice;
                    delete this.notifies[key];
                    try {
                        notify.hide();
                    } catch {
                        // NO OP
                    }
                });
            }
        }
    }
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.handleOnInitialise(this._everyOnloadStart.bind(this));
        services.appLifecycle.handleOnSettingLoaded(this._everyOnloadAfterLoadSettings.bind(this));
        services.appLifecycle.handleOnLoaded(this._everyOnload.bind(this));
        services.appLifecycle.handleOnBeforeUnload(this._allStartOnUnload.bind(this));
    }
}
