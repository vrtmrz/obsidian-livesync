import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fs, os, path } from "@vrtmrz/livesync-commonlib/node";
import { isStorageCaseInsensitive } from "./storageCaseSensitivity";
import { NodeServiceContext, NodeServiceHub } from "./NodeServiceHub";

vi.mock("@vrtmrz/livesync-commonlib/node", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@vrtmrz/livesync-commonlib/node")>();
    return { ...actual, fs: { ...actual.fs } };
});

describe("CLI storage case sensitivity", () => {
    let directory: string;
    let vaultPath: string;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-storage-case-"));
        vaultPath = path.join(directory, "vault");
        fs.mkdirSync(vaultPath);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    it("matches the Vault filesystem and leaves existing files untouched", () => {
        fs.writeFileSync(path.join(vaultPath, "Note.md"), "local content");
        const expected = fs.existsSync(path.join(vaultPath, "NOTE.MD"));

        expect(isStorageCaseInsensitive(vaultPath)).toBe(expected);

        expect(fs.readdirSync(vaultPath)).toEqual(["Note.md"]);
        expect(fs.readFileSync(path.join(vaultPath, "Note.md"), "utf8")).toBe("local content");
    });

    it("recognises an alternate spelling of the same filesystem entry", () => {
        const entry = fs.statSync(vaultPath);
        vi.spyOn(fs, "statSync").mockReturnValue(entry);

        expect(isStorageCaseInsensitive(vaultPath)).toBe(true);
        expect(fs.readdirSync(vaultPath)).toEqual([]);
    });

    it("does not mistake a different entry for the probe", () => {
        const original = fs.statSync(vaultPath);
        const other = fs.statSync(directory);
        vi.spyOn(fs, "statSync").mockReturnValueOnce(original).mockReturnValueOnce(other);

        expect(isStorageCaseInsensitive(vaultPath)).toBe(false);
        expect(fs.readdirSync(vaultPath)).toEqual([]);
    });

    it("reports inspection failures and removes its probe", () => {
        const failure = Object.assign(new Error("Cannot inspect the Vault"), { code: "EACCES" });
        vi.spyOn(fs, "statSync").mockImplementation(() => {
            throw failure;
        });

        expect(() => isStorageCaseInsensitive(vaultPath)).toThrow(failure);
        expect(fs.readdirSync(vaultPath)).toEqual([]);
    });

    it("lazily detects the selected Vault once per service hub", () => {
        const createProbe = vi.spyOn(fs, "mkdtempSync");
        const context = new NodeServiceContext(
            directory,
            {
                readStdin: async () => "",
                prompt: async () => "",
                writeStdout: () => undefined,
                writeStderr: () => undefined,
            },
            vaultPath
        );
        const hub = new NodeServiceHub(directory, context);
        expect(createProbe).not.toHaveBeenCalled();

        const first = hub.vault.isStorageInsensitive();
        expect(hub.vault.isStorageInsensitive()).toBe(first);
        expect(createProbe).toHaveBeenCalledExactlyOnceWith(path.join(vaultPath, ".livesync-case-"));
        expect(fs.readdirSync(vaultPath)).toEqual([]);
    });
});
