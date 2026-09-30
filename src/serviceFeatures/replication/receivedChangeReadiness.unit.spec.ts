import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { VERSIONING_DOCID, type EntryDoc } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { EVENT_SETTING_SAVED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { describe, expect, it, vi } from "vitest";
import { EVENT_APPLICATION_READY, eventHub } from "@/common/events";
import { useReplicationFeature } from "./index";

type ParseHandler = (documents: PouchDB.Core.ExistingDocument<EntryDoc>[]) => Promise<boolean>;

function receivedNote(id: string): PouchDB.Core.ExistingDocument<EntryDoc> {
    return {
        _id: id,
        _rev: "1-received",
        path: `${id}.md`,
        ctime: 1,
        mtime: 2,
        size: 1,
        children: [],
        datatype: "plain",
        type: "plain",
        eden: {},
    } as unknown as PouchDB.Core.ExistingDocument<EntryDoc>;
}

function setup() {
    let applicationReady = false;
    const settings = {
        handleFilenameCaseSensitive: false,
        ignoreFiles: "",
        maxMTimeForReflectEvents: 0,
        suspendParseReplicationResult: false,
        syncIgnoreRegEx: "",
        syncInternalFiles: false,
        syncMaxSizeInMB: 0,
        syncOnlyRegEx: "",
        useIgnoreFiles: false,
    };
    const processSynchroniseResult = vi.fn(async () => true);
    const settingLoadedHandlers: (() => Promise<boolean>)[] = [];
    const context = createServiceContext();
    const keyValueDB = {
        get: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
    };
    const localDatabase = {
        getRaw: vi.fn(async (id: string) => {
            if (id === VERSIONING_DOCID) throw { status: 404 };
            return { _id: id, _rev: "1-received" };
        }),
        getDBEntryFromMeta: vi.fn(async (entry: object) => ({ ...entry, data: "received content" })),
    };
    let parseHandler: ParseHandler | undefined;
    const services = {
        API: { isMobile: vi.fn(() => false), isOnline: true },
        appLifecycle: {
            getUnresolvedMessages: { addHandler: vi.fn() },
            isReady: () => applicationReady,
            isSuspended: vi.fn(() => false),
            onSettingLoaded: {
                addHandler: vi.fn((handler: () => Promise<boolean>) => settingLoadedHandlers.push(handler)),
            },
        },
        context,
        database: { isDatabaseReady: vi.fn(() => true) },
        databaseEvents: { onDatabaseInitialised: { addHandler: vi.fn() } },
        keyValueDB: { kvDB: keyValueDB },
        localDatabase,
        path: { getPath: vi.fn((entry: { path: string }) => entry.path) },
        replication: {
            databaseQueueCount: { value: 0 },
            storageApplyingCount: { value: 0 },
            replicationResultCount: { value: 0 },
            onBeforeReplicate: { addHandler: vi.fn() },
            onPrepareCentralRemoteReplication: { addHandler: vi.fn() },
            onReplicationFailed: { addHandler: vi.fn() },
            parseSynchroniseResult: {
                addHandler: vi.fn((handler: ParseHandler) => {
                    parseHandler = handler;
                }),
            },
            processOptionalSynchroniseResult: vi.fn(async () => false),
            processSynchroniseResult,
            processVirtualDocument: vi.fn(async () => false),
            replicateUnattendedByEvent: vi.fn(async () => ({ status: "completed" as const })),
        },
        replicator: {
            createRemoteResource: vi.fn(async () => ({
                read: vi.fn(async () => new Uint8Array([1])),
                dispose: vi.fn(),
            })),
            onBeforeReplicatorPublication: { addHandler: vi.fn() },
            onCloseActiveReplication: vi.fn(async () => true),
        },
        setting: { currentSettings: vi.fn(() => settings) },
        tweakValue: {},
        vault: {
            isFileSizeTooLarge: vi.fn(() => false),
            isTargetFile: vi.fn(async () => true),
            isValidPath: vi.fn(() => true),
        },
    };
    const core = {
        confirm: {},
        get localDatabase() {
            return localDatabase;
        },
        rebuilder: {},
        services,
    };

    useReplicationFeature(core as never);

    return {
        context,
        get applicationReady() {
            return applicationReady;
        },
        processSynchroniseResult,
        get parseHandler() {
            return parseHandler;
        },
        settingLoadedHandlers,
        setApplicationReady(value: boolean) {
            applicationReady = value;
        },
        settings,
    };
}

describe("received change readiness composition", () => {
    it("applies a queued received document once readiness is established and preserves explicit suspension", async () => {
        eventHub.offAll();
        const harness = setup();
        try {
            await harness.settingLoadedHandlers[0]();

            await harness.parseHandler!([receivedNote("ready-note")]);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(harness.processSynchroniseResult).not.toHaveBeenCalled();

            harness.setApplicationReady(true);
            harness.context.events.emitEvent(EVENT_APPLICATION_READY);
            harness.context.events.emitEvent(EVENT_APPLICATION_READY);

            await vi.waitFor(() => expect(harness.processSynchroniseResult).toHaveBeenCalledTimes(1));

            harness.settings.suspendParseReplicationResult = true;
            eventHub.emitEvent(EVENT_SETTING_SAVED, harness.settings as never);
            harness.setApplicationReady(false);
            await harness.parseHandler!([receivedNote("suspended-note")]);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(harness.processSynchroniseResult).toHaveBeenCalledTimes(1);

            harness.setApplicationReady(true);
            harness.context.events.emitEvent(EVENT_APPLICATION_READY);
            harness.context.events.emitEvent(EVENT_APPLICATION_READY);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(harness.processSynchroniseResult).toHaveBeenCalledTimes(1);

            harness.settings.suspendParseReplicationResult = false;
            eventHub.emitEvent(EVENT_SETTING_SAVED, harness.settings as never);

            await vi.waitFor(() => expect(harness.processSynchroniseResult).toHaveBeenCalledTimes(2));
            expect(harness.processSynchroniseResult).toHaveBeenLastCalledWith(
                expect.objectContaining({ _id: "suspended-note", path: "suspended-note.md" })
            );
        } finally {
            eventHub.offAll();
        }
    });
});
