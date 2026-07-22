import { describe, expect, it } from "vitest";
import {
    assertCouchDbCheckpointContinuity,
    assertJournalCheckpointLoaded,
    assertNoJournalReplay,
    type JournalCheckpointSnapshot,
} from "./upgradeContinuity.ts";

const journalCheckpoint: JournalCheckpointSnapshot = {
    remoteKey: "remote-a",
    lastLocalSeq: 42,
    journalEpoch: "2:salt",
    knownIDs: ["known-a"],
    sentIDs: ["sent-a"],
    receivedFiles: ["100-docs.jsonl.gz"],
    sentFiles: ["101-docs.jsonl.gz"],
};

describe("upgrade synchronisation continuity assertions", () => {
    it("rejects a fresh CouchDB checkpoint lineage even when final documents could still converge", () => {
        expect(() =>
            assertCouchDbCheckpointContinuity(
                [{ id: "_local/original", lastSequence: 42 }],
                [{ id: "_local/replacement", lastSequence: 42 }]
            )
        ).toThrow("checkpoint identity changed");
    });

    it("rejects an Object Storage checkpoint which was reset to its initial state", () => {
        expect(() =>
            assertJournalCheckpointLoaded(journalCheckpoint, {
                remoteKey: journalCheckpoint.remoteKey,
                lastLocalSeq: 0,
                journalEpoch: "",
                knownIDs: [],
                sentIDs: [],
                receivedFiles: [],
                sentFiles: [],
            })
        ).toThrow(/lastLocalSeq regressed|history was lost/u);
    });

    it("rejects hidden Object Storage replay during an otherwise unchanged sync", () => {
        expect(() =>
            assertNoJournalReplay(
                journalCheckpoint,
                journalCheckpoint,
                [{ key: "101-docs.jsonl.gz", size: 10, etag: "etag" }],
                [{ key: "101-docs.jsonl.gz", size: 10, etag: "etag" }],
                { downloadedJournalKeys: ["101-docs.jsonl.gz"], uploadedJournalKeys: [] }
            )
        ).toThrow("downloaded previously processed journals");
    });
});
