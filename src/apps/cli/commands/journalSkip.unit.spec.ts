import { describe, expect, it, vi } from "vitest";
import { LiveSyncJournalReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator";
import {
    REPLICATION_COMPLETED,
    REPLICATION_PROGRESS_PRESENTATIONS,
    USER_INITIATED_REPLICATION_AUTHORITY,
    replicationFailed,
} from "@vrtmrz/livesync-commonlib/replication";
import { runJournalSkipCommand } from "./journalSkip";

const snapshot = { key: "7-docs.jsonl.gz", stage: "parse" } as const;
const settings = {} as any;
type ReplicationResult = Awaited<ReturnType<Parameters<typeof runJournalSkipCommand>[1]["replicateUserInitiated"]>>;

function createStandardIoMock(events?: string[]) {
    return {
        readStdin: vi.fn(async () => ""),
        prompt: vi.fn(async () => ""),
        writeStdout: vi.fn((_chunk: string | Uint8Array) => events?.push("stdout")),
        writeStderr: vi.fn((_chunk: string | Uint8Array) => events?.push("stderr")),
    } as any;
}

function createJournalReplicatorMock(stoppedJournal: unknown, events?: string[]) {
    const replicator = Object.create(LiveSyncJournalReplicator.prototype) as any;
    replicator.getStoppedJournal = vi.fn(() => {
        events?.push("getStoppedJournal");
        return stoppedJournal;
    });
    replicator.skipStoppedJournalAndResume = vi.fn(async () => {
        events?.push("skipStoppedJournalAndResume");
        return true;
    });
    return replicator;
}

function createDependencies(replicator: any, result?: ReplicationResult, events?: string[]) {
    const standardIo = createStandardIoMock(events);
    return {
        standardIo,
        getActiveReplicator: vi.fn(() => {
            events?.push("getActiveReplicator");
            return replicator;
        }),
        replicateUserInitiated: vi.fn(async () => {
            events?.push("replicateUserInitiated");
            return result ?? replicationFailed(new Error("stopped Journal"));
        }),
        currentSettings: vi.fn(() => {
            events?.push("currentSettings");
            return settings;
        }),
    };
}

function makeOptions(commandArgs: string[]) {
    return { commandArgs };
}

describe("journal-skip command handler", () => {
    it("retries replication, then skips the exact stopped snapshot in order", async () => {
        const events: string[] = [];
        const replicator = createJournalReplicatorMock(snapshot, events);
        const dependencies = createDependencies(replicator, undefined, events);

        await expect(runJournalSkipCommand(makeOptions([snapshot.key]), dependencies)).resolves.toBe(true);

        expect(dependencies.replicateUserInitiated).toHaveBeenCalledWith({
            trigger: "manual",
            progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.NOTICE,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        });
        expect(dependencies.getActiveReplicator).toHaveBeenCalledTimes(2);
        expect(replicator.getStoppedJournal).toHaveBeenCalledOnce();
        expect(replicator.skipStoppedJournalAndResume).toHaveBeenCalledWith(settings, snapshot, true);
        expect(replicator.skipStoppedJournalAndResume.mock.calls[0][1]).toBe(snapshot);
        expect(events).toEqual([
            "stdout",
            "getActiveReplicator",
            "replicateUserInitiated",
            "getActiveReplicator",
            "getStoppedJournal",
            "currentSettings",
            "skipStoppedJournalAndResume",
        ]);
        expect(dependencies.standardIo.writeStdout).toHaveBeenCalledWith(`[Command] journal-skip ${snapshot.key}\n`);
        expect(dependencies.standardIo.writeStderr).not.toHaveBeenCalled();
    });

    it.each([
        { args: [], description: "no argument" },
        { args: [""], description: "an empty key" },
        { args: [snapshot.key, "extra"], description: "more than one argument" },
    ])("rejects $description before replication", async ({ args }) => {
        const replicator = createJournalReplicatorMock(snapshot);
        const dependencies = createDependencies(replicator);

        await expect(runJournalSkipCommand(makeOptions(args), dependencies)).resolves.toBe(false);

        expect(dependencies.standardIo.writeStdout).not.toHaveBeenCalled();
        expect(dependencies.standardIo.writeStderr).toHaveBeenCalledWith(
            "[Error] journal-skip requires one argument: <journal-key>\n"
        );
        expect(dependencies.getActiveReplicator).not.toHaveBeenCalled();
        expect(dependencies.replicateUserInitiated).not.toHaveBeenCalled();
    });

    it("refuses a completed replication before reading a stopped snapshot", async () => {
        const replicator = createJournalReplicatorMock(snapshot);
        const dependencies = createDependencies(replicator, REPLICATION_COMPLETED);

        await expect(runJournalSkipCommand(makeOptions([snapshot.key]), dependencies)).resolves.toBe(false);

        expect(replicator.getStoppedJournal).not.toHaveBeenCalled();
        expect(replicator.skipStoppedJournalAndResume).not.toHaveBeenCalled();
        expect(dependencies.standardIo.writeStderr).toHaveBeenCalledWith(
            "[Error] Replication completed without a stopped Journal; no Journal was skipped.\n"
        );
    });

    it.each([
        { status: "failed", error: new Error("stopped") },
        { status: "cancelled" },
        { status: "blocked", reason: "not-ready" },
        { status: "partial", detail: "incomplete" },
    ] satisfies ReplicationResult[])("requires a stopped snapshot after a $status outcome", async (result) => {
        const replicator = createJournalReplicatorMock(undefined);
        const dependencies = createDependencies(replicator, result);

        await expect(runJournalSkipCommand(makeOptions([snapshot.key]), dependencies)).resolves.toBe(false);

        expect(replicator.getStoppedJournal).toHaveBeenCalledOnce();
        expect(replicator.skipStoppedJournalAndResume).not.toHaveBeenCalled();
        expect(dependencies.standardIo.writeStderr).toHaveBeenCalledWith(
            "[Error] Replication did not stop at a Journal; no Journal was skipped.\n"
        );
    });

    it("refuses an active replicator which is not a Journal replicator", async () => {
        const otherReplicator = { getStoppedJournal: vi.fn(() => snapshot) };
        const dependencies = createDependencies(otherReplicator);

        await expect(runJournalSkipCommand(makeOptions([snapshot.key]), dependencies)).resolves.toBe(false);

        expect(otherReplicator.getStoppedJournal).not.toHaveBeenCalled();
        expect(dependencies.standardIo.writeStderr).toHaveBeenCalledWith(
            "[Error] The active replicator is not a Journal replicator; no Journal was skipped.\n"
        );
    });

    it("refuses if the active replicator changes while replication is awaited", async () => {
        const replicator = createJournalReplicatorMock(snapshot);
        const replacement = createJournalReplicatorMock(snapshot);
        const dependencies = createDependencies(replicator);
        dependencies.getActiveReplicator.mockReturnValueOnce(replicator).mockReturnValueOnce(replacement);

        await expect(runJournalSkipCommand(makeOptions([snapshot.key]), dependencies)).resolves.toBe(false);

        expect(replicator.getStoppedJournal).not.toHaveBeenCalled();
        expect(replicator.skipStoppedJournalAndResume).not.toHaveBeenCalled();
        expect(replacement.skipStoppedJournalAndResume).not.toHaveBeenCalled();
        expect(dependencies.standardIo.writeStderr).toHaveBeenCalledWith(
            "[Error] The active replicator changed during replication; no Journal was skipped.\n"
        );
    });

    it("refuses a stopped Journal whose key does not exactly match the requested key", async () => {
        const replicator = createJournalReplicatorMock(snapshot);
        const dependencies = createDependencies(replicator);

        await expect(runJournalSkipCommand(makeOptions(["8-docs.jsonl.gz"]), dependencies)).resolves.toBe(false);

        expect(replicator.skipStoppedJournalAndResume).not.toHaveBeenCalled();
        expect(dependencies.standardIo.writeStderr).toHaveBeenCalledWith(
            "[Error] Replication stopped at Journal '7-docs.jsonl.gz' (parse), not '8-docs.jsonl.gz'; no Journal was skipped.\n"
        );
    });

    it("returns false when resuming after a successful Journal skip returns false", async () => {
        const replicator = createJournalReplicatorMock(snapshot);
        replicator.skipStoppedJournalAndResume.mockResolvedValue(false);
        const dependencies = createDependencies(replicator);

        await expect(runJournalSkipCommand(makeOptions([snapshot.key]), dependencies)).resolves.toBe(false);

        expect(replicator.skipStoppedJournalAndResume).toHaveBeenCalledOnce();
        expect(dependencies.standardIo.writeStderr).not.toHaveBeenCalled();
    });

    it("propagates rejected replication", async () => {
        const replicator = createJournalReplicatorMock(snapshot);
        const dependencies = createDependencies(replicator);
        const error = new Error("replication rejected");
        dependencies.replicateUserInitiated.mockRejectedValue(error);

        await expect(runJournalSkipCommand(makeOptions([snapshot.key]), dependencies)).rejects.toBe(error);

        expect(dependencies.getActiveReplicator).toHaveBeenCalledOnce();
        expect(dependencies.standardIo.writeStderr).not.toHaveBeenCalled();
        expect(replicator.skipStoppedJournalAndResume).not.toHaveBeenCalled();
    });

    it("propagates a rejected skip and resume operation", async () => {
        const replicator = createJournalReplicatorMock(snapshot);
        const dependencies = createDependencies(replicator);
        const error = new Error("skip rejected");
        replicator.skipStoppedJournalAndResume.mockRejectedValue(error);

        await expect(runJournalSkipCommand(makeOptions([snapshot.key]), dependencies)).rejects.toBe(error);

        expect(replicator.skipStoppedJournalAndResume).toHaveBeenCalledOnce();
    });
});
