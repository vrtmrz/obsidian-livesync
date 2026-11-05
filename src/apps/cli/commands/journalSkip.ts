import type { StandardIo } from "@vrtmrz/livesync-commonlib/context";
import {
    isReplicationCompleted,
    REPLICATION_PROGRESS_PRESENTATIONS,
    USER_INITIATED_REPLICATION_AUTHORITY,
} from "@vrtmrz/livesync-commonlib/replication";
import { isLiveSyncJournalReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator";
import { writeStderrLine, writeStdoutLine } from "@/apps/cli/cliOutput";
import type { CLICommandContext, CLIOptions } from "./types";

type JournalSkipOptions = Pick<CLIOptions, "commandArgs">;

type JournalSkipContext = {
    standardIo: StandardIo;
    getActiveReplicator: CLICommandContext["core"]["services"]["replicator"]["getActiveReplicator"];
    replicateUserInitiated: CLICommandContext["core"]["services"]["replication"]["replicateUserInitiated"];
    currentSettings: CLICommandContext["core"]["services"]["setting"]["currentSettings"];
};

/** Retry replication, then skip only the exact Journal snapshot left by the same replicator. */
export async function runJournalSkipCommand(
    options: JournalSkipOptions,
    context: JournalSkipContext
): Promise<boolean> {
    const { standardIo } = context;
    const [journalKey] = options.commandArgs;
    if (options.commandArgs.length !== 1 || journalKey === undefined || journalKey.length === 0) {
        writeStderrLine(standardIo, `[Error] journal-skip requires one argument: <journal-key>`);
        return false;
    }

    writeStdoutLine(standardIo, `[Command] journal-skip ${journalKey}`);
    const replicatorBeforeReplication = context.getActiveReplicator();
    const result = await context.replicateUserInitiated({
        trigger: "manual",
        progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.NOTICE,
        interaction: USER_INITIATED_REPLICATION_AUTHORITY,
    });
    const activeReplicator = context.getActiveReplicator();

    if (activeReplicator !== replicatorBeforeReplication) {
        writeStderrLine(
            standardIo,
            `[Error] The active replicator changed during replication; no Journal was skipped.`
        );
        return false;
    }
    if (isReplicationCompleted(result)) {
        writeStderrLine(standardIo, `[Error] Replication completed without a stopped Journal; no Journal was skipped.`);
        return false;
    }
    if (!isLiveSyncJournalReplicator(activeReplicator)) {
        writeStderrLine(
            standardIo,
            `[Error] The active replicator is not a Journal replicator; no Journal was skipped.`
        );
        return false;
    }

    const stoppedJournal = activeReplicator.getStoppedJournal();
    if (!stoppedJournal) {
        writeStderrLine(standardIo, `[Error] Replication did not stop at a Journal; no Journal was skipped.`);
        return false;
    }
    if (stoppedJournal.key !== journalKey) {
        writeStderrLine(
            standardIo,
            `[Error] Replication stopped at Journal '${stoppedJournal.key}' (${stoppedJournal.stage}), not '${journalKey}'; no Journal was skipped.`
        );
        return false;
    }

    return await activeReplicator.skipStoppedJournalAndResume(context.currentSettings(), stoppedJournal, true);
}
