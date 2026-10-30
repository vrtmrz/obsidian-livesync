import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/settings";
import { REMOTE_MINIO, REMOTE_P2P } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.const";
import {
    FlagFilesHumanReadable,
    FlagFilesOriginal,
} from "@vrtmrz/livesync-commonlib/compat/common/models/redflag.const";
import {
    clearFetchSelection,
    deleteFetchFlags,
    describeFetchRemote,
    readFetchSelection,
    saveFetchSelection,
} from "./redFlag.fetchState";
import { readFetchFlagState, writeFetchFlagState } from "./redFlag.fetchStateMarkdown";
import {
    askSimpleFetchMode,
    SIMPLE_FETCH_STAGE1_REMOTE_WINS,
    SIMPLE_FETCH_STAGE2_REMOTE_DELETE_NONE,
} from "./redFlag.simpleFetch";

const modern = FlagFilesHumanReadable.FETCH_ALL;
const legacy = FlagFilesOriginal.FETCH_ALL;
const stage1 = SIMPLE_FETCH_STAGE1_REMOTE_WINS;
const stage2 = SIMPLE_FETCH_STAGE2_REMOTE_DELETE_NONE;

function fixture() {
    const files = new Map<string, string>([[modern, ""]]);
    const settings = { ...DEFAULT_SETTINGS, couchDB_URI: "https://example.invalid", couchDB_DBNAME: "vault" };
    const storage = {
        normalisePath: (path: string) => path,
        isExists: vi.fn(async (path: string) => files.has(path)),
        readFileText: vi.fn(async (path: string) => {
            if (!files.has(path)) throw new Error("missing file");
            return files.get(path)!;
        }),
        writeFileAuto: vi.fn(async (path: string, value: string) => {
            files.set(path, value);
            return true;
        }),
        delete: vi.fn(async (path: string) => {
            files.delete(path);
        }),
    };
    const confirm = vi.fn(async (_title: string, _message: string, buttons: string[]) => buttons[1]);
    const host = {
        services: { setting: { currentSettings: () => settings }, UI: { confirm: { confirmWithMessage: confirm } } },
        serviceModules: { storageAccess: storage },
    } as any;
    return { host, files, settings, storage, confirm };
}

describe("Fetch flag state", () => {
    it("preserves Markdown and reuses the selection independently of the database suffix", async () => {
        const { host, files, settings } = fixture();
        await saveFetchSelection(host, stage1, stage2);
        const prose = "# My recovery notes\n\nKeep this explanation.\n\n";
        files.set(modern, prose + files.get(modern)!);
        await saveFetchSelection(host, stage1, stage2);
        expect(files.get(modern)).toContain(prose);
        settings.additionalSuffixOfDatabaseName = "changed-by-rebuild";
        await expect(readFetchSelection(host)).resolves.toMatchObject({ stage1, stage2 });
        await clearFetchSelection(host);
        expect(files.get(modern)).toContain(prose);
        expect(readFetchFlagState(files.get(modern)!)).toBeUndefined();
    });

    it("reads and updates the legacy filename when it is the only flag", async () => {
        const { host, files } = fixture();
        files.delete(modern);
        files.set(legacy, "");
        await saveFetchSelection(host, stage1, stage2);
        await expect(readFetchSelection(host)).resolves.toMatchObject({ stage1, stage2 });
        expect(files.has(modern)).toBe(false);
        await deleteFetchFlags(host);
        expect(files.size).toBe(0);
    });

    it("treats a new empty canonical flag as a new operation even when a legacy selection remains", async () => {
        const { host, files, confirm } = fixture();
        await saveFetchSelection(host, stage1, stage2);
        files.set(legacy, files.get(modern)!);
        files.set(modern, "");
        await askSimpleFetchMode(host);
        expect(confirm).toHaveBeenCalledTimes(2);
        await deleteFetchFlags(host);
        expect(files.size).toBe(0);
    });

    it("does not fall back to the legacy flag when reading the canonical flag fails", async () => {
        const { host, files, storage } = fixture();
        files.set(legacy, "");
        storage.readFileText.mockRejectedValueOnce(new Error("read failed"));
        await expect(readFetchSelection(host)).rejects.toThrow("read failed");
        expect(storage.readFileText).toHaveBeenCalledOnce();
    });

    it("does not create an unsolicited fetch flag when none exists", async () => {
        const { host, files, storage } = fixture();
        files.clear();
        await expect(saveFetchSelection(host, stage1, stage2)).rejects.toThrow("flag is missing");
        expect(storage.writeFileAuto).not.toHaveBeenCalled();
    });

    it("rejects a save when the storage silently retains different content", async () => {
        const { host, storage } = fixture();
        storage.writeFileAuto.mockResolvedValueOnce(true);
        await expect(saveFetchSelection(host, stage1, stage2)).rejects.toThrow("could not be saved");
    });

    it("retains the authoritative flag when removing the legacy alias fails", async () => {
        const { host, files, storage } = fixture();
        files.set(legacy, "");
        storage.delete.mockRejectedValueOnce(new Error("delete failed"));
        await expect(deleteFetchFlags(host)).rejects.toThrow("delete failed");
        expect(files.has(modern)).toBe(true);
        expect(storage.delete).toHaveBeenCalledOnce();
    });

    it("detects a deletion which returned without removing the flag", async () => {
        const { host, files, storage } = fixture();
        storage.delete.mockResolvedValueOnce(undefined);
        await expect(deleteFetchFlags(host)).rejects.toThrow("Could not remove");
        expect(files.has(modern)).toBe(true);
    });

    it.each([
        { stage1: "unknown", stage2 },
        { stage1, stage2: "Delete local files if deleted on remote" },
        { stage1: "Use the detailed flow", stage2 },
    ])("asks again for an invalid combination: %j", async (choices) => {
        const { host, files, storage, confirm } = fixture();
        files.set(
            modern,
            writeFetchFlagState("", {
                type: "livesync-fast-setup",
                version: 1,
                ...choices,
            })
        );
        const original = files.get(modern);
        confirm.mockImplementationOnce(async (_title, _message, buttons) => buttons[0]);
        await askSimpleFetchMode(host);
        expect(confirm).toHaveBeenCalledTimes(3);
        expect(files.get(modern)).toBe(original);
        expect(storage.writeFileAuto).not.toHaveBeenCalled();
    });

    it.each([
        { remoteType: "" as const, couchDB_DBNAME: "different-vault" },
        { remoteType: REMOTE_MINIO, endpoint: "https://s3.invalid", bucket: "other-bucket" },
        { remoteType: REMOTE_P2P, P2P_roomID: "other-room" },
    ])("requires explicit confirmation for the currently selected remote: %j", async (remote) => {
        const { host, settings, confirm } = fixture();
        await saveFetchSelection(host, stage1, stage2);
        Object.assign(settings, remote);
        await expect(readFetchSelection(host)).resolves.toMatchObject({ stage1, stage2 });
        confirm.mockImplementationOnce(async (_title, _message, buttons) => buttons[0]);
        await askSimpleFetchMode(host);
        expect(confirm).toHaveBeenCalledOnce();
        expect(confirm.mock.calls[0][1]).toContain("Current remote:");
    });
});

describe("Fetch destination description", () => {
    it("omits URL credentials, query parameters, fragments, and connection secrets", () => {
        const { settings } = fixture();
        Object.assign(settings, {
            couchDB_URI: "https://alice:secret@example.invalid/path?token=secret#secret",
            couchDB_USER: "alice",
            couchDB_PASSWORD: "secret",
            jwtKey: "secret",
            passphrase: "secret",
            additionalSuffixOfDatabaseName: "another-device",
        });
        expect(describeFetchRemote(settings)).toBe("CouchDB / https://example.invalid/path / vault");
    });

    it("shows Object Storage prefixes and P2P rooms without relay credentials", () => {
        const { settings } = fixture();
        Object.assign(settings, {
            remoteType: REMOTE_MINIO,
            endpoint: "https://s3.invalid",
            region: "region",
            bucket: "vault",
            bucketPrefix: "one/",
        });
        expect(describeFetchRemote(settings)).toContain("vault / one/");
        Object.assign(settings, {
            remoteType: REMOTE_P2P,
            P2P_roomID: "group",
            P2P_passphrase: "secret",
            P2P_relays: "wss://alice:secret@relay.invalid?token=secret,wss://other.invalid",
        });
        const description = describeFetchRemote(settings);
        expect(description).toContain("group");
        expect(description).toContain("wss://relay.invalid");
        expect(description).toContain("wss://other.invalid");
        expect(description).not.toContain("secret");
        expect(description).not.toContain("alice");
    });
});
