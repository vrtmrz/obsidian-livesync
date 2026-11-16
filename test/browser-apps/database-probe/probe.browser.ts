import { PouchDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/pouchdb-browser";
import {
    createDatabaseProbeFixture,
    observeDatabaseProbeBrowserEvents,
} from "../../../src/features/ReviewHarness/reviewHarnessDatabaseProbeRuntime";
import type {
    DatabaseProbeEvent,
    DatabaseProbeFixture,
} from "../../../src/features/ReviewHarness/reviewHarnessDatabaseProbe";

declare global {
    interface Window {
        runDatabaseProbeSmoke(): Promise<Record<string, unknown>>;
    }
}

function requireCondition(value: boolean, message: string): void {
    if (!value) {
        throw new Error(message);
    }
}

window.runDatabaseProbeSmoke = async () => {
    const originalOpen = indexedDB.open;
    const events: DatabaseProbeEvent[] = [];
    const aborter = new AbortController();
    const controlName = `database-probe-control-${crypto.randomUUID()}`;
    let control: IDBDatabase | undefined;
    let unobserve: (() => void) | undefined;
    let fixture: DatabaseProbeFixture | undefined;
    try {
        control = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(controlName, 1);
            request.onupgradeneeded = () => request.result.createObjectStore("control");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(new Error("The independent control database could not open"));
        });
        unobserve = observeDatabaseProbeBrowserEvents(document, window, (event) => events.push(event));
        fixture = await createDatabaseProbeFixture({
            factory: indexedDB,
            PouchDB,
            token: crypto.randomUUID(),
            emit: (event) => events.push(event),
            signal: aborter.signal,
        });
        requireCondition(
            indexedDB.open === originalOpen,
            "Native open capture was not restored before user observation"
        );
        const before = await fixture.check(aborter.signal);
        requireCondition(!before.connectionFailure, "The initial fixture was not readable");
        requireCondition(
            before.observations.some((value) => value.includes("contentMatches=true; revisionMatches=true")),
            "The fixture contents were not checked"
        );

        // Synthetic browser events verify registration only; they do not simulate iOS suspension.
        window.dispatchEvent(new Event("pagehide"));
        window.dispatchEvent(new Event("pageshow"));
        fixture.closeNative();
        const controlRead = control.transaction("control", "readonly");
        await new Promise<void>((resolve, reject) => {
            controlRead.oncomplete = () => resolve();
            controlRead.onabort = () => reject(new Error("The diagnostic affected an independent connection"));
            controlRead.objectStore("control").get("absent");
        });
        const closed = await fixture.check(aborter.signal);
        requireCondition(closed.connectionFailure, "The retained native-close failure was not reproduced");
        requireCondition(
            closed.observations.some((value) => value.includes("same-name-instance.get=error; name=InvalidStateError")),
            "A same-name PouchDB unexpectedly escaped the stale cache"
        );
        requireCondition(
            !events.some((event) => event.source === "fixture-native" && event.name === "close" && !event.registration),
            "Explicit native close incorrectly appeared as an abnormal native close event"
        );

        const reopened = await fixture.reopen(aborter.signal);
        requireCondition(!reopened.connectionFailure, "Explicit diagnostic reopen failed");
        requireCondition(
            reopened.observations.some((value) => value.includes("contentMatches=true; revisionMatches=true")),
            "Reopen did not preserve the fixture contents and revision"
        );
        requireCondition(indexedDB.open === originalOpen, "Reopen left the native capture installed");
        await fixture.cleanup();
        fixture = undefined;
        requireCondition(
            events.some((event) => event.name === "fixture-deleted"),
            "The disposable fixture was not deleted"
        );
        requireCondition(
            events.some((event) => event.source === "fixture-pouch" && event.name === "closed" && !event.registration),
            "PouchDB's closed event was not observed"
        );
        return { before: before.observations, closed: closed.observations, reopened: reopened.observations, events };
    } finally {
        try {
            unobserve?.();
        } finally {
            try {
                await fixture?.cleanup();
            } finally {
                try {
                    control?.close();
                } finally {
                    indexedDB.deleteDatabase(controlName);
                }
            }
        }
    }
};
