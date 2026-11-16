import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import type { DocumentID, LoadedEntry } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { $msg } from "@/common/translation";
import type { ObsidianNoticeGroups } from "@/modules/services/ObsidianNoticeGroups";
import type { PendingReflection, ReflectionRecoveryView } from "./ReplicateResultProcessor";
import { OPEN_REFLECTION_RECOVERY_REVIEW } from "./reflectionRecoveryCommand";

type ReflectionRecoveryReviewHost = NecessaryServices<"API" | "UI" | "database" | "path" | "appLifecycle", never>;

const noticeGroup = "reflection-recovery-review";
const noticeItem = "pending-targets";

type ReviewTarget = {
    pending: PendingReflection;
    path: string;
    reason: string;
    label: string;
};

function targetKey(target: PendingReflection): string {
    return JSON.stringify([target.documentId, target.revision]);
}

function stateLabel(target: PendingReflection): string {
    const state = target.state === "waiting" ? $msg("Waiting") : $msg("Needs review");
    return target.running ? `${state} — ${$msg("Retry running")}` : state;
}

function readableReason(target: PendingReflection): string {
    const descriptions: Record<string, string> = {
        "local-database": $msg("The local database connection was unavailable when the file was being reflected."),
        offline: $msg("The network was offline when the file content was needed."),
        transport: $msg("A network error prevented the file content from being retrieved."),
        missing: $msg("Required file content was not found on the server."),
        invalid: $msg("The retrieved file content could not be validated."),
        cancelled: $msg("The content request was cancelled."),
        unavailable: $msg("The file content could not be retrieved."),
        authentication: $msg("The server did not authorise the content request."),
        configuration: $msg("Connection settings or compatibility checks prevented the content request."),
        interrupted: $msg("The previous retry was interrupted. Review the file before retrying."),
        "snapshot-save-failed": $msg(
            "The pending recovery state could not be saved. The automatic retry was not started."
        ),
        "reflection-failed": $msg("Reflection could not be confirmed after the retry."),
    };
    if (descriptions[target.reason]) {
        return descriptions[target.reason];
    }
    const reason = target.reason.trim();
    if (reason.length === 0) {
        return $msg("Reason unavailable");
    }
    return reason.length > 180 ? `${reason.slice(0, 177)}…` : reason;
}

async function resolveTarget(
    services: ReflectionRecoveryReviewHost["services"],
    pending: PendingReflection,
    index: number
): Promise<ReviewTarget> {
    let path = pending.documentId;
    try {
        const metadata = await services.database.localDatabase.getRaw<LoadedEntry>(pending.documentId as DocumentID);
        if (typeof metadata.path === "string") {
            const resolvedPath = services.path.getPath(metadata);
            if (resolvedPath) {
                path = resolvedPath;
            }
        }
    } catch {
        // Retain the unresolved record and expose its local document ID as the fallback target.
    }
    const reason = readableReason(pending);
    return {
        pending,
        path,
        reason,
        label: `${index + 1}. ${path} — ${stateLabel(pending)} — ${reason}`,
    };
}

/** Own the reflection-recovery dialogue, command, and grouped Notice for one host. */
export function useReflectionRecoveryReview(
    host: ReflectionRecoveryReviewHost,
    recovery: ReflectionRecoveryView,
    notices: ObsidianNoticeGroups
): void {
    const { services } = host;
    let disposed = false;
    let active = false;
    let startupCheckComplete = false;
    let stopRecoveryChanges: (() => void) | undefined;
    const notified = new Set<string>();

    const refreshNotice = () => {
        if (disposed || !startupCheckComplete) {
            return;
        }
        const needsReview = recovery.list().filter(({ state, running }) => state === "review" && !running);
        if (needsReview.length === 0) {
            notices.removeItem(noticeGroup, noticeItem);
            notices.hide(noticeGroup);
            return;
        }

        const newTargets = needsReview.filter((target) => !notified.has(targetKey(target)));
        if (newTargets.length === 0) {
            return;
        }
        for (const target of newTargets) {
            notified.add(targetKey(target));
        }
        notices.setItem(noticeGroup, noticeItem, {
            message: $msg("Some files could not be reflected in the Vault. Review the affected files."),
            action: {
                label: $msg("Review files"),
                onSelect: () => {
                    if (!disposed) {
                        void services.UI.commands.invoke(OPEN_REFLECTION_RECOVERY_REVIEW, undefined);
                    }
                },
            },
        });
        notices.finish(noticeGroup, { durationMs: 15000 });
    };

    const showNoTargets = async (): Promise<void> => {
        const close = $msg("Close");
        await services.UI.confirm.askSelectStringDialogue(
            $msg("There are no files waiting for reflection review."),
            [close],
            { title: $msg("Review files"), defaultAction: close }
        );
    };

    const openReview = async (): Promise<void> => {
        const close = $msg("Close");
        const back = $msg("Back to file list");
        const retry = $msg("Retry this file");

        while (!disposed) {
            const pending = recovery.list();
            if (pending.length === 0) {
                await showNoTargets();
                return;
            }

            const targets = await Promise.all(pending.map((target, index) => resolveTarget(services, target, index)));
            if (disposed) {
                return;
            }
            const selectedLabel = await services.UI.confirm.askSelectString(
                $msg("Choose a file to review. Each entry shows its state and reason."),
                targets.map(({ label }) => label)
            );
            if (disposed || selectedLabel === "") {
                return;
            }
            const selected = targets.find(({ label }) => label === selectedLabel);
            if (!selected) {
                continue;
            }

            const current = recovery
                .list()
                .find(
                    (candidate) =>
                        candidate.documentId === selected.pending.documentId &&
                        candidate.revision === selected.pending.revision
                );
            if (!current || current.running) {
                continue;
            }

            const detail = `${selected.path}\n${stateLabel(current)}\n${readableReason(current)}`;
            const choice = await services.UI.confirm.askSelectStringDialogue(detail, [retry, back, close], {
                title: $msg("Review file"),
                defaultAction: back,
            });
            if (disposed || choice === false || choice === close) {
                return;
            }
            if (choice === back) {
                continue;
            }
            if (choice !== retry) {
                return;
            }

            const latest = recovery
                .list()
                .find(
                    (candidate) =>
                        candidate.documentId === current.documentId && candidate.revision === current.revision
                );
            if (!latest || latest.running) {
                continue;
            }
            try {
                await recovery.retry([latest.documentId]);
            } catch {
                if (disposed) {
                    return;
                }
                await services.UI.confirm.askSelectStringDialogue(
                    $msg("The retry could not be started. Try again later."),
                    [close],
                    { title: $msg("Review file"), defaultAction: close }
                );
                if (disposed) {
                    return;
                }
            }
        }
    };

    const unregisterCommand = services.UI.commands.register(OPEN_REFLECTION_RECOVERY_REVIEW, async () => {
        if (disposed) {
            return "unavailable";
        }
        if (active) {
            return "already-open";
        }
        active = true;
        try {
            await recovery.reconcile();
            await openReview();
        } catch {
            // Host dialogue shutdown can reject an active request during unload.
        } finally {
            active = false;
        }
        return disposed ? "unavailable" : "closed";
    });

    const stopStartupCheck = services.appLifecycle.onScanningStartupIssues.addHandler(async () => {
        await recovery.reconcile();
        if (disposed) {
            return true;
        }
        startupCheckComplete = true;
        stopRecoveryChanges ??= recovery.onChanged(refreshNotice);
        refreshNotice();
        return true;
    });

    services.appLifecycle.onUnload.addHandler(() => {
        disposed = true;
        stopRecoveryChanges?.();
        stopRecoveryChanges = undefined;
        stopStartupCheck();
        unregisterCommand();
        notices.removeItem(noticeGroup, noticeItem);
        notices.hide(noticeGroup);
        notified.clear();
        return Promise.resolve(true);
    });
}
