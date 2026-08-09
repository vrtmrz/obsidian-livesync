export type CouchDbCheckpointSnapshot = {
    id: string;
    lastSequence: unknown;
};

export type CouchDbDocumentRevision = {
    id: string;
    revision: string;
    deleted: boolean;
};

export type JournalCheckpointSnapshot = {
    remoteKey: string;
    lastLocalSeq: number | string;
    journalEpoch: string;
    knownIDs: readonly string[];
    sentIDs: readonly string[];
    receivedFiles: readonly string[];
    sentFiles: readonly string[];
};

export type JournalIoObservation = {
    downloadedJournalKeys: readonly string[];
    uploadedJournalKeys: readonly string[];
};

export type RemoteObjectSnapshot = {
    key: string;
    size: number;
    etag: string;
};

export type MilestoneIdentity = {
    created: unknown;
    locked: boolean;
    acceptedNodes: readonly string[];
};

function sorted(values: readonly string[]): string[] {
    return [...values].sort((left, right) => left.localeCompare(right));
}

function assertEqualStrings(actual: readonly string[], expected: readonly string[], message: string): void {
    const actualSorted = sorted(actual);
    const expectedSorted = sorted(expected);
    if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
        throw new Error(`${message}\nExpected: ${JSON.stringify(expectedSorted)}\nActual: ${JSON.stringify(actualSorted)}`);
    }
}

function assertSubset(previous: readonly string[], current: readonly string[], message: string): void {
    const currentSet = new Set(current);
    const missing = previous.filter((value) => !currentSet.has(value));
    if (missing.length > 0) throw new Error(`${message}: ${missing.join(", ")}`);
}

function sequenceNumber(sequence: unknown): number | undefined {
    if (typeof sequence === "number" && Number.isFinite(sequence)) return sequence;
    if (typeof sequence !== "string") return undefined;
    const match = /^(\d+)/u.exec(sequence);
    return match ? Number(match[1]) : undefined;
}

function assertSequenceDidNotRegress(before: unknown, after: unknown, label: string): void {
    const beforeNumber = sequenceNumber(before);
    const afterNumber = sequenceNumber(after);
    if (beforeNumber !== undefined && afterNumber !== undefined) {
        if (afterNumber < beforeNumber) {
            throw new Error(`${label} regressed from ${String(before)} to ${String(after)}.`);
        }
        return;
    }
    if (before !== after) {
        throw new Error(`${label} changed from an opaque sequence ${String(before)} to ${String(after)}.`);
    }
}

export function assertCouchDbCheckpointContinuity(
    before: readonly CouchDbCheckpointSnapshot[],
    after: readonly CouchDbCheckpointSnapshot[]
): void {
    if (before.length === 0) throw new Error("The stable release did not create a CouchDB replication checkpoint.");
    assertEqualStrings(
        after.map(({ id }) => id),
        before.map(({ id }) => id),
        "The CouchDB replication checkpoint identity changed during the upgrade."
    );
    const afterById = new Map(after.map((checkpoint) => [checkpoint.id, checkpoint]));
    for (const checkpoint of before) {
        assertSequenceDidNotRegress(
            checkpoint.lastSequence,
            afterById.get(checkpoint.id)?.lastSequence,
            `CouchDB checkpoint ${checkpoint.id}`
        );
    }
}

export function assertSomeCouchDbCheckpointAdvanced(
    before: readonly CouchDbCheckpointSnapshot[],
    after: readonly CouchDbCheckpointSnapshot[]
): void {
    assertCouchDbCheckpointContinuity(before, after);
    const afterById = new Map(after.map((checkpoint) => [checkpoint.id, checkpoint]));
    const advanced = before.some((checkpoint) => {
        const previous = sequenceNumber(checkpoint.lastSequence);
        const current = sequenceNumber(afterById.get(checkpoint.id)?.lastSequence);
        return previous !== undefined && current !== undefined && current > previous;
    });
    if (!advanced) throw new Error("No CouchDB replication checkpoint advanced after the post-upgrade change.");
}

export function assertCouchDbDocumentsUnchanged(
    before: readonly CouchDbDocumentRevision[],
    after: readonly CouchDbDocumentRevision[]
): void {
    const serialise = (documents: readonly CouchDbDocumentRevision[]) =>
        [...documents].sort((left, right) => left.id.localeCompare(right.id));
    if (JSON.stringify(serialise(before)) !== JSON.stringify(serialise(after))) {
        throw new Error("A no-op post-upgrade CouchDB synchronisation changed ordinary remote documents.");
    }
}

export function assertJournalCheckpointLoaded(
    before: JournalCheckpointSnapshot,
    after: JournalCheckpointSnapshot
): void {
    if (sequenceNumber(before.lastLocalSeq) === 0) {
        throw new Error("The stable release did not advance the Object Storage local checkpoint.");
    }
    if (after.remoteKey !== before.remoteKey) {
        throw new Error(`The Object Storage checkpoint key changed from ${before.remoteKey} to ${after.remoteKey}.`);
    }
    assertSequenceDidNotRegress(before.lastLocalSeq, after.lastLocalSeq, "Object Storage lastLocalSeq");
    assertSubset(before.knownIDs, after.knownIDs, "Object Storage known revision history was lost");
    assertSubset(before.sentIDs, after.sentIDs, "Object Storage sent revision history was lost");
    assertSubset(before.receivedFiles, after.receivedFiles, "Object Storage received journal history was lost");
    assertSubset(before.sentFiles, after.sentFiles, "Object Storage sent journal history was lost");
    if (before.journalEpoch && after.journalEpoch !== before.journalEpoch) {
        throw new Error(
            `The Object Storage journal epoch changed from ${before.journalEpoch} to ${after.journalEpoch}.`
        );
    }
}

export function assertNoJournalReplay(
    beforeCheckpoint: JournalCheckpointSnapshot,
    afterCheckpoint: JournalCheckpointSnapshot,
    beforeObjects: readonly RemoteObjectSnapshot[],
    afterObjects: readonly RemoteObjectSnapshot[],
    observation: JournalIoObservation
): void {
    assertJournalCheckpointLoaded(beforeCheckpoint, afterCheckpoint);
    assertEqualStrings(
        afterObjects.map(({ key }) => key),
        beforeObjects.map(({ key }) => key),
        "A no-op post-upgrade Object Storage synchronisation changed the journal object set."
    );
    if (observation.downloadedJournalKeys.length > 0) {
        throw new Error(
            `The no-op synchronisation downloaded previously processed journals: ${observation.downloadedJournalKeys.join(", ")}`
        );
    }
    if (observation.uploadedJournalKeys.length > 0) {
        throw new Error(
            `The no-op synchronisation uploaded replay journals: ${observation.uploadedJournalKeys.join(", ")}`
        );
    }
}

export function assertJournalCheckpointAdvanced(
    before: JournalCheckpointSnapshot,
    after: JournalCheckpointSnapshot,
    observation: JournalIoObservation
): void {
    assertJournalCheckpointLoaded(before, after);
    const beforeSequence = sequenceNumber(before.lastLocalSeq);
    const afterSequence = sequenceNumber(after.lastLocalSeq);
    if (beforeSequence === undefined || afterSequence === undefined || afterSequence <= beforeSequence) {
        throw new Error(
            `The Object Storage checkpoint did not advance after the post-upgrade change (${String(before.lastLocalSeq)} -> ${String(after.lastLocalSeq)}).`
        );
    }
    if (observation.uploadedJournalKeys.length === 0) {
        throw new Error("The post-upgrade Object Storage change did not create a new journal.");
    }
}

export function assertMilestoneContinuity(before: MilestoneIdentity, after: MilestoneIdentity): void {
    if (before.created === undefined || before.created === null) {
        throw new Error("The stable release milestone does not expose a remote generation identity.");
    }
    if (after.created !== before.created) {
        throw new Error(`The remote milestone generation changed from ${String(before.created)} to ${String(after.created)}.`);
    }
    if (after.locked !== before.locked) {
        throw new Error(`The remote milestone lock changed from ${String(before.locked)} to ${String(after.locked)}.`);
    }
    assertSubset(before.acceptedNodes, after.acceptedNodes, "The remote milestone lost an accepted device");
}
