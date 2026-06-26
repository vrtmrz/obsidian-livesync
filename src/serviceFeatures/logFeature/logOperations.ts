import { computed, reactive, reactiveSource, type ReactiveValue } from "octagonal-wheels/dataobject/reactive";
import {
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_INFO,
    LOG_LEVEL_VERBOSE,
    PREFIXMD_LOGFILE,
    type DatabaseConnectingStatus,
    type LOG_LEVEL,
} from "@lib/common/types.ts";
import { cancelTask, scheduleTask } from "octagonal-wheels/concurrency/task";
import { fireAndForget, isDirty, throttle } from "@lib/common/utils.ts";
import {
    collectingChunks,
    pluginScanningCount,
    hiddenFilesEventCount,
    hiddenFilesProcessingCount,
    logMessages,
} from "@lib/mock_and_interop/stores.ts";
import { debounce, normalizePath, Notice } from "@/deps.ts";
import { LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import { serialized } from "octagonal-wheels/concurrency/lock";
import { LiveSyncError } from "@lib/common/LSError.ts";
import { isValidPath } from "@/common/utils.ts";
import {
    isValidFilenameInAndroid,
    isValidFilenameInDarwin,
    isValidFilenameInWidows,
} from "@lib/string_and_binary/path.ts";
import { MARK_LOG_NETWORK_ERROR, MARK_LOG_SEPARATOR } from "@lib/services/lib/logUtils.ts";
import { NetworkWarningStyles } from "@lib/common/models/setting.const.ts";
import { compatGlobal } from "@lib/common/coreEnvFunctions.ts";
import type { LogFeatureHost } from "./types.ts";
import type { LogFeatureState } from "./state.ts";

export const MARK_DONE = "\u{2009}\u{2009}";
const showDebugLog = false;

const updateLogMessageMap = new WeakMap<LogFeatureState, () => void>();

function getUpdateLogMessage(state: LogFeatureState): () => void {
    let fn = updateLogMessageMap.get(state);
    if (!fn) {
        fn = debounce(() => {
            logMessages.value = [...state.logForDisplay];
        }, 25);
        updateLogMessageMap.set(state, fn);
    }
    return fn;
}

export function addLog(state: LogFeatureState, log: string): void {
    state.logForDump.push(log);
    while (state.logForDump.length > 1000) {
        state.logForDump.shift();
    }
}

export function addDisplayLog(state: LogFeatureState, log: string): void {
    state.logForDisplay.push(log);
    while (state.logForDisplay.length > 200) {
        state.logForDisplay.shift();
    }
    getUpdateLogMessage(state)();
}

const redactPatterns = [/PBKDF2 salt \(Security Seed\):.*$/];

export function redactLog(log: string): string {
    let redactedLog = log;
    for (const pattern of redactPatterns) {
        redactedLog = redactedLog.replace(pattern, (match) => {
            return match.split(":")[0] + ": [REDACTED]";
        });
    }
    return redactedLog;
}

export function writeLogToTheFile(host: LogFeatureHost, now: Date, vaultName: string, newMessage: string): void {
    fireAndForget(() =>
        serialized("writeLog", async () => {
            const time = now.toISOString().split("T")[0];
            const logDate = `${PREFIXMD_LOGFILE}${time}.md`;
            const file = await host.serviceModules.storageAccess.isExists(normalizePath(logDate));
            if (!file) {
                await host.serviceModules.storageAccess.appendHiddenFile(normalizePath(logDate), "```\n");
            }
            await host.serviceModules.storageAccess.appendHiddenFile(
                normalizePath(logDate),
                vaultName + ":" + newMessage + "\n"
            );
        })
    );
}

export function processAddLog(
    host: LogFeatureHost,
    state: LogFeatureState,
    message: unknown,
    level: LOG_LEVEL = LOG_LEVEL_INFO,
    key = ""
): void {
    if (level === LOG_LEVEL_DEBUG && !showDebugLog) {
        return;
    }
    const settings = host.services.setting.settings;
    let memoOnly = false;
    if (level <= LOG_LEVEL_INFO && settings && settings.lessInformationInLog) {
        memoOnly = true;
    }
    if (settings && !settings.showVerboseLog && level === LOG_LEVEL_VERBOSE) {
        memoOnly = true;
    }
    const vaultName = host.services.vault.getVaultName();
    const now = new Date();
    const timestamp = now.toLocaleString();
    let errorInfo = "";
    if (message instanceof Error) {
        if (message instanceof LiveSyncError) {
            if (message.cause && message.cause instanceof Error) {
                const causedError = message.cause;
                errorInfo = `${causedError?.name}:${causedError?.message}\n[StackTrace]: ${message.stack}\n[CausedBy]: ${causedError?.stack}`;
            } else {
                errorInfo = `${message.name}:${message.message}\n[StackTrace]: ${message.stack}`;
            }
        } else {
            const thisStack = new Error().stack;
            errorInfo = `${message.name}:${message.message}\n[StackTrace]: ${message.stack}\n[LogCallStack]: ${thisStack}`;
        }
    }
    const messageContent =
        typeof message === "string"
            ? message
            : message instanceof Error
              ? `${errorInfo}`
              : JSON.stringify(message, null, 2);
    const newMessage = timestamp + "->" + messageContent;

    if (settings?.writeLogToTheFile) {
        writeLogToTheFile(host, now, vaultName, newMessage);
    }
    addLog(state, newMessage);
    if (memoOnly) {
        return;
    }
    addDisplayLog(state, newMessage);
    if (message instanceof Error) {
        console.error(vaultName + ":" + newMessage);
    } else if (level >= LOG_LEVEL_INFO) {
        console.log(vaultName + ":" + newMessage);
    } else {
        console.debug(vaultName + ":" + newMessage);
    }
    if (!settings?.showOnlyIconsOnEditor) {
        state.statusLog.value = messageContent;
    }
    state.logLines.push({ ttl: now.getTime() + 3000, message: newMessage });

    if (level >= LOG_LEVEL_NOTICE) {
        let notifyKey = key;
        if (!notifyKey) notifyKey = messageContent;
        if (notifyKey in state.notifies) {
            // @ts-ignore
            const isShown = state.notifies[notifyKey].notice.noticeEl?.isShown();
            if (!isShown) {
                state.notifies[notifyKey].notice = new Notice(messageContent, 0);
            }
            cancelTask(`notify-${notifyKey}`);
            if (notifyKey === messageContent) {
                state.notifies[notifyKey].count++;
                state.notifies[notifyKey].notice.setMessage(`(${state.notifies[notifyKey].count}):${messageContent}`);
            } else {
                state.notifies[notifyKey].notice.setMessage(`${messageContent}`);
            }
        } else {
            const notify = new Notice(messageContent, 0);
            state.notifies[notifyKey] = {
                count: 0,
                notice: notify,
            };
        }
        const timeout = 5000;
        if (!notifyKey.startsWith("keepalive-") || messageContent.indexOf(MARK_DONE) !== -1) {
            scheduleTask(`notify-${notifyKey}`, timeout, () => {
                const notify = state.notifies[notifyKey].notice;
                delete state.notifies[notifyKey];
                try {
                    notify.hide();
                } catch {
                    // NO OP
                }
            });
        }
    }
}

export function adjustStatusDivPosition(host: LogFeatureHost, state: LogFeatureState): void {
    const app = (host as any).app;
    const mdv = app.workspace.getMostRecentLeaf();
    if (mdv && state.statusDiv) {
        state.statusDiv.remove();
        const container = mdv.view.containerEl;
        container.appendChild(state.statusDiv);
    }
}

export async function getActiveFileStatus(host: LogFeatureHost): Promise<string> {
    const app = (host as any).app;
    const reason = [] as string[];
    const reasonWarn = [] as string[];
    const thisFile = app.workspace.getActiveFile();
    if (!thisFile) return "";
    const validPath = isValidPath(thisFile.path);
    if (!validPath) {
        reason.push("This file has an invalid path under the current settings");
    } else {
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
    if (host.services.vault.shouldCheckCaseInsensitively()) {
        const f = (await host.serviceModules.storageAccess.getFiles())
            .map((e) => e.path)
            .filter((e) => e.toLowerCase() === thisFile.path.toLowerCase());
        if (f.length > 1) {
            reason.push("There are multiple files with the same name (case-insensitive match)");
        }
    }
    if (!(await host.services.vault.isTargetFile(thisFile.path))) {
        reason.push("This file is ignored by the ignore rules");
    }
    if (host.services.vault.isFileSizeTooLarge(thisFile.stat.size)) {
        reason.push("This file size exceeds the configured limit");
    }
    const result = reason.length > 0 ? "Not synchronised: " + reason.join(", ") : "";
    const warnResult = reasonWarn.length > 0 ? "Warning: " + reasonWarn.join(", ") : "";
    return [result, warnResult].filter((e) => e).join("\n");
}

export async function setFileStatus(host: LogFeatureHost, state: LogFeatureState): Promise<void> {
    const fileStatus = await getActiveFileStatus(host);
    state.activeFileStatus.value = fileStatus;
}

export async function updateMessageArea(host: LogFeatureHost, state: LogFeatureState): Promise<void> {
    if (!state.messageArea) return;
    const settings = host.services.setting.settings;

    const showStatusOnEditor = settings?.showStatusOnEditor ?? false;
    if (state.statusDiv) {
        state.statusDiv.setCssStyles({ display: showStatusOnEditor ? "" : "none" });
    }
    if (!showStatusOnEditor) {
        state.messageArea.innerText = "";
        return;
    }

    const messageLines = [];
    const fileStatus = state.activeFileStatus.value;
    if (fileStatus && !settings.hideFileWarningNotice) messageLines.push(fileStatus);
    const messages = (await host.services.appLifecycle.getUnresolvedMessages()).flat().filter((e) => e);
    const stringMessages = messages.filter((m): m is string => typeof m === "string");
    const networkMessages = stringMessages.filter((m) => m.startsWith(MARK_LOG_NETWORK_ERROR));
    const otherMessages = stringMessages.filter((m) => !m.startsWith(MARK_LOG_NETWORK_ERROR));

    messageLines.push(...otherMessages);

    if (
        settings.networkWarningStyle !== NetworkWarningStyles.ICON &&
        settings.networkWarningStyle !== NetworkWarningStyles.HIDDEN
    ) {
        messageLines.push(...networkMessages);
    } else if (settings.networkWarningStyle === NetworkWarningStyles.ICON) {
        if (networkMessages.length > 0) messageLines.push("🔗❌");
    }
    state.messageArea.innerText = messageLines.map((e) => `⚠️ ${e}`).join("\n");
}

export function onActiveLeafChange(host: LogFeatureHost, state: LogFeatureState): void {
    fireAndForget(async () => {
        adjustStatusDivPosition(host, state);
        await setFileStatus(host, state);
    });
}

export function applyStatusBarText(host: LogFeatureHost, state: LogFeatureState): void {
    if (state.nextFrameQueue) {
        return;
    }
    const settings = host.services.setting.settings;
    state.nextFrameQueue = compatGlobal.requestAnimationFrame(() => {
        state.nextFrameQueue = undefined;
        if (!state.statusBarLabels) return;
        const { message, status } = state.statusBarLabels.value;
        const newMsg = message;
        let newLog = settings?.showOnlyIconsOnEditor ? "" : status;
        const moduleTagEnd = newLog.indexOf(`]${MARK_LOG_SEPARATOR}`);
        if (moduleTagEnd !== -1) {
            newLog = newLog.substring(moduleTagEnd + MARK_LOG_SEPARATOR.length + 1);
        }

        state.statusBar?.setText(newMsg.split("\n")[0]);
        if (state.statusDiv) {
            state.statusDiv.setCssStyles({ display: settings?.showStatusOnEditor ? "" : "none" });
        }
        if (settings?.showStatusOnEditor && state.statusDiv) {
            if (settings.showLongerLogInsideEditor) {
                const now = new Date().getTime();
                state.logLines = state.logLines.filter((e) => e.ttl > now);
                const minimumNext = state.logLines.reduce((a, b) => (a < b.ttl ? a : b.ttl), Number.MAX_SAFE_INTEGER);
                if (state.logLines.length > 0)
                    compatGlobal.setTimeout(() => applyStatusBarText(host, state), minimumNext - now);
                const recent = state.logLines.map((e) => e.message);
                const recentLogs = recent.reverse().join("\n");
                if (isDirty("recentLogs", recentLogs)) state.logHistory!.innerText = recentLogs;
            }
            if (isDirty("newMsg", newMsg)) state.statusLine!.innerText = newMsg;
            if (isDirty("newLog", newLog)) state.logMessage!.innerText = newLog;
        }
    });

    scheduleTask("log-hide", 3000, () => {
        state.statusLog.value = "";
    });
}

export function observeForLogs(host: LogFeatureHost, state: LogFeatureState): void {
    const padSpaces = `\u{2007}`.repeat(10);
    const settings = host.services.setting.settings;

    function padLeftSpComputed(numI: ReactiveValue<number>, mark: string) {
        const formatted = reactiveSource("");
        let timer: number | undefined = undefined;
        let maxLen = 1;
        numI.onChanged((numX) => {
            const num = numX.value;
            const numLen = `${Math.abs(num)}`.length + 1;
            maxLen = maxLen < numLen ? numLen : maxLen;
            if (timer) compatGlobal.clearTimeout(timer);
            if (num === 0) {
                timer = compatGlobal.setTimeout(() => {
                    formatted.value = "";
                    maxLen = 1;
                }, 3000);
            }
            formatted.value = ` ${mark}${`${padSpaces}${num}`.slice(-maxLen)}`;
        });
        return computed(() => formatted.value);
    }

    const labelReplication = padLeftSpComputed(host.services.replication.replicationResultCount, `📥`);
    const labelDBCount = padLeftSpComputed(host.services.replication.databaseQueueCount, `📄`);
    const labelStorageCount = padLeftSpComputed(host.services.replication.storageApplyingCount, `💾`);
    const labelChunkCount = padLeftSpComputed(collectingChunks, `🧩`);
    const labelPluginScanCount = padLeftSpComputed(pluginScanningCount, `🔌`);
    const labelConflictProcessCount = padLeftSpComputed(host.services.conflict.conflictProcessQueueCount, `🔩`);
    const hiddenFilesCount = reactive(() => hiddenFilesEventCount.value - hiddenFilesProcessingCount.value);
    const labelHiddenFilesCount = padLeftSpComputed(hiddenFilesCount, `⚙️`);
    const queueCountLabelX = reactive(() => {
        return `${labelReplication()}${labelDBCount()}${labelStorageCount()}${labelChunkCount()}${labelPluginScanCount()}${labelHiddenFilesCount()}${labelConflictProcessCount()}`;
    });
    const queueCountLabel = () => queueCountLabelX.value;

    const requestingStatLabel = computed(() => {
        const diff = host.services.API.requestCount.value - host.services.API.responseCount.value;
        return diff !== 0 ? "📲 " : "";
    });

    const replicationStatLabel = computed(() => {
        const e = host.services.replicator.replicationStatics.value;
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
                w = labels[e.syncStatus as DatabaseConnectingStatus] || "⚡";
                pushLast =
                    lastSyncPushSeq === 0
                        ? ""
                        : lastSyncPushSeq >= maxPushSeq
                          ? " (LIVE)"
                          : ` (${maxPushSeq - lastSyncPushSeq})`;
                pullLast =
                    lastSyncPullSeq === 0
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
    const labelProc = padLeftSpComputed(host.services.fileProcessing.processing, `⏳`);
    const labelPend = padLeftSpComputed(host.services.fileProcessing.totalQueued, `🛫`);
    const labelInBatchDelay = padLeftSpComputed(host.services.fileProcessing.batched, `📬`);
    const waitingLabel = computed(() => {
        return `${labelProc()}${labelPend()}${labelInBatchDelay()}`;
    });
    const statusLineLabel = computed(() => {
        const { w, sent, pushLast, arrived, pullLast } = replicationStatLabel();
        const queued = queueCountLabel();
        const waiting = waitingLabel();
        const networkActivity = requestingStatLabel();
        const p2p = state.p2pLogCollector.p2pReplicationLine.value;
        return {
            message: `${networkActivity}Sync: ${w} ↑ ${sent}${pushLast} ↓ ${arrived}${pullLast}${waiting}${queued}${p2p === "" ? "" : "\n" + p2p}`,
        };
    });

    const statusBarLabels = reactive(() => {
        const scheduleMessage = host.services.appLifecycle.isReloadingScheduled()
            ? `WARNING! RESTARTING OBSIDIAN IS SCHEDULED!\n`
            : "";
        const { message } = statusLineLabel();
        const fileStatus = state.activeFileStatus.value;
        const status = scheduleMessage + state.statusLog.value;
        const fileStatusIcon = `${fileStatus && settings.hideFileWarningNotice ? " ⛔ SKIP" : ""}`;
        return {
            message: `${message}${fileStatusIcon}`,
            status,
        };
    });
    state.statusBarLabels = statusBarLabels;

    const applyToDisplay = throttle((label: typeof statusBarLabels.value) => {
        applyStatusBarText(host, state);
    }, 20);
    statusBarLabels.onChanged((label) => applyToDisplay(label.value));
    state.activeFileStatus.onChanged(() => updateMessageArea(host, state));
}
