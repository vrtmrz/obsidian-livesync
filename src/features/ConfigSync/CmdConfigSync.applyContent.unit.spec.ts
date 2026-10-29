import { describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({
    addIcon: vi.fn(),
    diff_match_patch: class DiffMatchPatch {},
    normalizePath: vi.fn((path: string) => path),
    parseYaml: vi.fn(),
    Platform: {},
}));
vi.mock("./PluginDialogModal.ts", () => ({
    PluginDialogModal: class PluginDialogModal {},
}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({
    JsonResolveModal: class JsonResolveModal {},
}));
vi.mock("@/modules/features/InteractiveConflictResolving/ConflictResolveModal.ts", () => ({
    ConflictResolveModal: class ConflictResolveModal {},
}));
vi.mock("@/features/LiveSyncCommands.ts", () => ({
    LiveSyncCommands: class LiveSyncCommands {
        core!: { services: unknown };
        get services() {
            return this.core.services;
        }
    },
}));
vi.mock("@/common/types.ts", () => ({
    ICXHeader: "ix:",
    PERIODIC_PLUGIN_SWEEP: 60,
}));
vi.mock("@/common/utils.ts", () => ({
    cancelTask: vi.fn(),
    EVEN: Symbol("even"),
    isCustomisationSyncMetadata: vi.fn(),
    isPluginMetadata: vi.fn(),
    scheduleTask: vi.fn(),
}));
vi.mock("@/common/PeriodicProcessor.ts", () => ({
    PeriodicProcessor: class PeriodicProcessor {},
}));
vi.mock("@/common/events.ts", () => ({
    EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG: "open-plugin-sync",
    eventHub: {
        onEvent: vi.fn(),
    },
}));
vi.mock("@/common/translation", () => ({
    $msg: vi.fn((message: string) => message),
}));
vi.mock("@/common/obsidianCommunityPlugins.ts", () => ({
    getObsidianCommunityPluginManager: vi.fn(),
}));

import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ConfigSync, type PluginDataExDisplayV2 } from "./CmdConfigSync";

const BASE_DIR = ".obsidian";
const DEVICE_NAME = "test-device";
const STAT = { mtime: 123456, ctime: 123000 };

type ApplyFile = {
    filename: string;
    datatype: "newnote" | "plain";
    data: string[];
    mtime: number;
    ctime: number;
};

function makeApplyFile(datatype: ApplyFile["datatype"], data: string[]): ApplyFile {
    return {
        filename: "plugins/example/data.json",
        datatype,
        data,
        mtime: STAT.mtime,
        ctime: STAT.ctime,
    };
}

function setup(file: ApplyFile, currentText = "before", currentBinary = new ArrayBuffer(0)) {
    const path = `${BASE_DIR}/${file.filename}`;
    const events: string[] = [];
    const storageAccess = {
        ensureDir: vi.fn(async (_path: string) => {
            events.push("ensure");
        }),
        readHiddenFileText: vi.fn(async (_path: string) => {
            events.push("read-text");
            return currentText;
        }),
        readHiddenFileBinary: vi.fn(async (_path: string) => {
            events.push("read-binary");
            return currentBinary;
        }),
        writeHiddenFileAuto: vi.fn(
            async (_path: string, _content: string | ArrayBuffer, _stat?: { mtime: number; ctime: number }) => {
                events.push("write");
            }
        ),
    };
    const storeCustomisationFileV2 = vi.fn(async (_path: string, _term: string) => {
        events.push("store");
        return true;
    });
    const log = vi.fn();
    const configSync = Object.create(ConfigSync.prototype) as ConfigSync;
    Object.assign(configSync, {
        core: {
            services: {
                API: { getSystemConfigDir: () => BASE_DIR },
                setting: { getDeviceAndVaultName: () => DEVICE_NAME },
            },
            storageAccess,
        },
        _log: log,
        storeCustomisationFileV2,
    });
    const data = {
        displayName: "Example plug-in",
        name: "example",
        files: [file],
    } as unknown as PluginDataExDisplayV2;
    return { configSync, data, events, log, path, storageAccess, storeCustomisationFileV2 };
}

const changedInputs = [
    {
        kind: "text",
        file: makeApplyFile("plain", ["replacement text"]),
        currentText: "previous text",
        expectedText: "replacement text",
    },
    {
        kind: "binary",
        file: makeApplyFile("newnote", ["AQID"]),
        currentBinary: new Uint8Array([9]).buffer,
        expectedBytes: [1, 2, 3],
    },
] as const;

const unchangedInputs = [
    {
        kind: "text",
        file: makeApplyFile("plain", ["unchanged text"]),
        currentText: "unchanged text",
    },
    {
        kind: "binary",
        file: makeApplyFile("newnote", ["AQID"]),
        currentBinary: new Uint8Array([1, 2, 3]).buffer,
    },
] as const;

describe("ConfigSync V2 content application", () => {
    it.each(changedInputs)("writes changed $kind content, then stores it", async (input) => {
        const fixture = setup(
            input.file,
            input.kind === "text" ? input.currentText : undefined,
            input.kind === "binary" ? input.currentBinary : undefined
        );

        await expect(fixture.configSync.applyDataV2(fixture.data)).resolves.toBe(true);

        expect(fixture.storageAccess.ensureDir).toHaveBeenCalledWith(fixture.path);
        expect(fixture.storageAccess.writeHiddenFileAuto).toHaveBeenCalledOnce();
        expect(fixture.storageAccess.writeHiddenFileAuto).toHaveBeenCalledWith(
            fixture.path,
            input.kind === "text" ? input.expectedText : expect.any(ArrayBuffer),
            STAT
        );
        if (input.kind === "binary") {
            const written = fixture.storageAccess.writeHiddenFileAuto.mock.calls[0]?.[1];
            expect(written).toBeInstanceOf(ArrayBuffer);
            expect(Array.from(new Uint8Array(written as ArrayBuffer))).toEqual(input.expectedBytes);
        }
        expect(fixture.events).toEqual([
            "ensure",
            input.kind === "text" ? "read-text" : "read-binary",
            "write",
            "store",
        ]);
        expect(fixture.storeCustomisationFileV2).toHaveBeenCalledWith(fixture.path, DEVICE_NAME);
    });

    it("writes the file timestamps captured before reading existing content", async () => {
        const file = makeApplyFile("plain", ["replacement text"]);
        const fixture = setup(file, "previous text");
        fixture.storageAccess.readHiddenFileText.mockImplementation(async () => {
            fixture.events.push("read-text");
            file.mtime = STAT.mtime + 1;
            file.ctime = STAT.ctime + 1;
            return "previous text";
        });

        await expect(fixture.configSync.applyDataV2(fixture.data)).resolves.toBe(true);

        expect(fixture.storageAccess.writeHiddenFileAuto).toHaveBeenCalledWith(fixture.path, "replacement text", STAT);
    });

    it.each(unchangedInputs)("skips writing and storing unchanged $kind content", async (input) => {
        const fixture = setup(
            input.file,
            input.kind === "text" ? input.currentText : undefined,
            input.kind === "binary" ? input.currentBinary : undefined
        );

        await expect(fixture.configSync.applyDataV2(fixture.data)).resolves.toBe(true);

        expect(fixture.storageAccess.writeHiddenFileAuto).not.toHaveBeenCalled();
        expect(fixture.storeCustomisationFileV2).not.toHaveBeenCalled();
        expect(fixture.events).toEqual(["ensure", input.kind === "text" ? "read-text" : "read-binary"]);
        expect(fixture.log).toHaveBeenCalledWith(
            `The file ${input.file.filename} is already up-to-date`,
            LOG_LEVEL_VERBOSE
        );
    });

    it.each([
        { kind: "text", file: makeApplyFile("plain", ["replacement text"]) },
        { kind: "binary", file: makeApplyFile("newnote", ["AQID"]) },
    ])("uses empty $kind content when reading the existing file fails", async ({ kind, file }) => {
        const fixture = setup(file);
        const readError = new Error("Could not read existing content");
        if (kind === "text") {
            fixture.storageAccess.readHiddenFileText.mockRejectedValueOnce(readError);
        } else {
            fixture.storageAccess.readHiddenFileBinary.mockRejectedValueOnce(readError);
        }

        await expect(fixture.configSync.applyDataV2(fixture.data)).resolves.toBe(true);

        expect(fixture.storageAccess.writeHiddenFileAuto).toHaveBeenCalledOnce();
        expect(fixture.storeCustomisationFileV2).toHaveBeenCalledWith(fixture.path, DEVICE_NAME);
        expect(fixture.log).toHaveBeenCalledWith(`Could not read the file ${file.filename}`, LOG_LEVEL_VERBOSE);
        expect(fixture.log).toHaveBeenCalledWith(readError, LOG_LEVEL_VERBOSE);
    });

    it("awaits the write before storing the applied content", async () => {
        const file = makeApplyFile("plain", ["replacement text"]);
        const fixture = setup(file, "previous text");
        let finishWrite!: () => void;
        let signalWriteStarted!: () => void;
        const writeGate = new Promise<void>((resolve) => {
            finishWrite = resolve;
        });
        const writeStarted = new Promise<void>((resolve) => {
            signalWriteStarted = resolve;
        });
        fixture.storageAccess.writeHiddenFileAuto.mockImplementation(async () => {
            fixture.events.push("write-start");
            signalWriteStarted();
            await writeGate;
            fixture.events.push("write-finished");
        });

        const applying = fixture.configSync.applyDataV2(fixture.data);
        await writeStarted;
        expect(fixture.storeCustomisationFileV2).not.toHaveBeenCalled();

        finishWrite();
        await expect(applying).resolves.toBe(true);
        expect(fixture.events.slice(-3)).toEqual(["write-start", "write-finished", "store"]);
    });

    it("returns false after a write failure and does not store the file", async () => {
        const fixture = setup(makeApplyFile("plain", ["replacement text"]), "previous text");
        const writeError = new Error("Write failed");
        fixture.storageAccess.writeHiddenFileAuto.mockRejectedValueOnce(writeError);

        await expect(fixture.configSync.applyDataV2(fixture.data)).resolves.toBe(false);

        expect(fixture.storeCustomisationFileV2).not.toHaveBeenCalled();
        expect(fixture.log).toHaveBeenCalledWith("Applying Example plug-in.. Failed", LOG_LEVEL_NOTICE);
        expect(fixture.log).toHaveBeenCalledWith(writeError, LOG_LEVEL_VERBOSE);
    });
});
