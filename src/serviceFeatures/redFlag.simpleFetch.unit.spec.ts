import { afterEach, describe, expect, it, vi } from "vitest";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { FullScanModes } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner";
import { $msg, setLang } from "@/common/translation";
import { askSimpleFetchMode } from "./redFlag.simpleFetch";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/settings";
import { FlagFilesHumanReadable } from "@vrtmrz/livesync-commonlib/compat/common/models/redflag.const";
import { REMOTE_P2P } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.const";
import { readFetchFlagState, writeFetchFlagState } from "./redFlag.fetchStateMarkdown";

const REMOTE_WINS = "Overwrite all with remote files";
const KEEP_LOCAL = "Keep local files even if not on remote";

async function createHost(savedChoice?: string) {
    const smallConfig = new Map<string, string>();
    if (savedChoice) smallConfig.set("simple-fetch-mode", savedChoice);
    const config = {
        getValue: vi.fn(async (key: string, defaultValue = "") => smallConfig.get(key) ?? defaultValue),
        setValue: vi.fn(async (key: string, value: string) => {
            smallConfig.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
            smallConfig.delete(key);
        }),
    };
    const settings = { ...DEFAULT_SETTINGS, couchDB_URI: "https://example.invalid", couchDB_DBNAME: "vault" };
    const flagPath = FlagFilesHumanReadable.FETCH_ALL;
    const files = new Map<string, string>([[flagPath, ""]]);
    const storage = {
        normalisePath: (path: string) => path,
        isExists: vi.fn(async (path: string) => files.has(path)),
        readFileText: vi.fn(async (path: string) => files.get(path)!),
        writeFileAuto: vi.fn(async (path: string, text: string) => {
            files.set(path, text);
            return true;
        }),
    };
    const rememberedMarkdown = writeFetchFlagState("", {
        type: "livesync-fast-setup",
        version: 1,
        stage1: REMOTE_WINS,
        stage2: KEEP_LOCAL,
    });
    const confirmWithMessage =
        vi.fn<(title: string, message: string, buttons: string[], defaultAction: string) => Promise<string | false>>();
    const host = {
        services: {
            UI: { confirm: { confirmWithMessage } },
            setting: {
                config,
                currentSettings: () => settings,
            },
        },
        serviceModules: { storageAccess: storage },
    } as unknown as NecessaryServices<"UI" | "setting", "storageAccess">;
    return { host, confirmWithMessage, smallConfig, config, files, storage, flagPath, rememberedMarkdown, settings };
}

afterEach(() => setLang("def"));

describe("Fast Setup translated choices", () => {
    it("uses the current language after the module has loaded and saves stable choice values", async () => {
        const { host, confirmWithMessage, files, flagPath } = await createHost();
        setLang("es");
        confirmWithMessage.mockImplementation(async (_title, _message, buttons) => buttons[1]);

        await expect(askSimpleFetchMode(host)).resolves.toEqual({
            mode: "remote-only",
            options: { mode: FullScanModes.DB_APPLY, extraOnRemote: undefined },
        });

        const [title, message, buttons] = confirmWithMessage.mock.calls[0];
        expect(title).toBe($msg("Data retrieval scheduled"));
        expect(buttons[1]).toBe($msg(REMOTE_WINS));
        expect(buttons[1]).not.toBe(REMOTE_WINS);
        expect(message).toContain($msg(REMOTE_WINS));
        expect(confirmWithMessage.mock.calls[1][2][1]).toBe($msg(KEEP_LOCAL));
        expect(readFetchFlagState(files.get(flagPath)!)).toMatchObject({
            stage1: REMOTE_WINS,
            stage2: KEEP_LOCAL,
        });
    });

    it("waits for the saved choice before returning it to the fetch workflow", async () => {
        const { host, confirmWithMessage, files, flagPath, storage } = await createHost();
        let markSaveStarted!: () => void;
        const saveStarted = new Promise<void>((resolve) => {
            markSaveStarted = resolve;
        });
        let finishSave!: () => void;
        const save = new Promise<void>((resolve) => {
            finishSave = resolve;
        });
        storage.writeFileAuto.mockImplementation(async (key, value) => {
            markSaveStarted();
            await save;
            files.set(key, value);
            return true;
        });
        confirmWithMessage.mockImplementation(async (_title, _message, buttons) => buttons[1]);

        const asking = askSimpleFetchMode(host);
        await saveStarted;

        expect(files.get(flagPath)).toBe("");
        expect(confirmWithMessage).toHaveBeenCalledTimes(2);

        finishSave();
        await expect(asking).resolves.toMatchObject({ mode: "remote-only" });
        expect(readFetchFlagState(files.get(flagPath)!)).toMatchObject({
            stage1: REMOTE_WINS,
            stage2: KEEP_LOCAL,
        });
    });

    it("propagates a stored-choice read failure instead of treating it as missing", async () => {
        const { host, confirmWithMessage, storage } = await createHost();
        storage.readFileText.mockRejectedValueOnce(new Error("choice read failed"));

        await expect(askSimpleFetchMode(host)).rejects.toThrow("choice read failed");

        expect(confirmWithMessage).not.toHaveBeenCalled();
    });

    it("asks before proceeding with an invalid selection block and leaves it unchanged", async () => {
        const { host, confirmWithMessage, files, flagPath, storage } = await createHost();
        const markdown = '```json\n{"type":"livesync-fast-setup", broken}\n```\n';
        files.set(flagPath, markdown);
        confirmWithMessage.mockResolvedValueOnce(false);
        await expect(askSimpleFetchMode(host)).resolves.toBe("cancelled");
        expect(confirmWithMessage).toHaveBeenCalledOnce();
        expect(confirmWithMessage.mock.calls[0][0]).toBe("Saved fetch choices could not be read");
        expect(files.get(flagPath)).toBe(markdown);
        expect(storage.writeFileAuto).not.toHaveBeenCalled();
    });

    it("confirms stable flag choices while displaying Spanish", async () => {
        const { host, confirmWithMessage, files, flagPath, rememberedMarkdown } = await createHost();
        files.set(flagPath, rememberedMarkdown);
        setLang("es");
        confirmWithMessage.mockImplementationOnce(async (_title, _message, buttons) => buttons[0]);
        await expect(askSimpleFetchMode(host)).resolves.toEqual({
            mode: "remote-only",
            options: { mode: FullScanModes.DB_APPLY, extraOnRemote: undefined },
        });
        expect(confirmWithMessage).toHaveBeenCalledOnce();
        expect(confirmWithMessage.mock.calls[0][1]).toContain($msg(REMOTE_WINS));
        expect(confirmWithMessage.mock.calls[0][1]).toContain($msg(KEEP_LOCAL));
        expect(files.get(flagPath)).toBe(rememberedMarkdown);
    });

    it("asks again instead of migrating the previous localStorage choice", async () => {
        const savedChoice = JSON.stringify({ stage1: REMOTE_WINS, stage2: KEEP_LOCAL });
        const { host, confirmWithMessage, config, smallConfig } = await createHost(savedChoice);
        setLang("es");
        confirmWithMessage.mockImplementation(async (_title, _message, buttons) => buttons[3]);
        await expect(askSimpleFetchMode(host)).resolves.toBe("cancelled");
        expect(confirmWithMessage).toHaveBeenCalledOnce();
        expect(config.getValue).not.toHaveBeenCalled();
        expect(smallConfig.get("simple-fetch-mode")).toBe(savedChoice);
    });

    it("uses the new language in the second dialogue without changing the first choice", async () => {
        const { host, confirmWithMessage, files, flagPath } = await createHost();
        setLang("def");
        confirmWithMessage
            .mockImplementationOnce(async (_title, _message, buttons) => {
                setLang("es");
                return buttons[1];
            })
            .mockImplementationOnce(async (_title, _message, buttons) => buttons[1]);

        await expect(askSimpleFetchMode(host)).resolves.toMatchObject({ mode: "remote-only" });

        expect(confirmWithMessage.mock.calls[0][2][1]).toBe(REMOTE_WINS);
        expect(confirmWithMessage.mock.calls[1][2][1]).toBe($msg(KEEP_LOCAL));
        expect(readFetchFlagState(files.get(flagPath)!)).toMatchObject({
            stage1: REMOTE_WINS,
            stage2: KEEP_LOCAL,
        });
    });

    it("recognises the translated cancellation choice", async () => {
        const { host, confirmWithMessage, files, flagPath } = await createHost();
        setLang("es");
        confirmWithMessage.mockImplementationOnce(async (_title, _message, buttons) => buttons[3]);

        await expect(askSimpleFetchMode(host)).resolves.toBe("cancelled");

        expect(confirmWithMessage.mock.calls[0][2][3]).toBe($msg("Cancel"));
        expect(files.get(flagPath)).toBe("");
    });

    it("saves English-compatible values when the module initially loads in Spanish", async () => {
        vi.resetModules();
        const translation = await import("@/common/translation");
        translation.setLang("es");
        const { askSimpleFetchMode: askAfterSpanishStartup } = await import("./redFlag.simpleFetch");
        const { host, confirmWithMessage, files, flagPath } = await createHost();
        confirmWithMessage.mockImplementation(async (_title, _message, buttons) => buttons[1]);

        try {
            await expect(askAfterSpanishStartup(host)).resolves.toMatchObject({ mode: "remote-only" });
            expect(readFetchFlagState(files.get(flagPath)!)).toMatchObject({
                stage1: REMOTE_WINS,
                stage2: KEEP_LOCAL,
            });
        } finally {
            translation.setLang("def");
        }
    });
});

describe("Fetch restart confirmation regressions", () => {
    it("requires explicit confirmation even when the saved selection is valid", async () => {
        const { host, files, flagPath, rememberedMarkdown, confirmWithMessage } = await createHost();
        files.set(flagPath, rememberedMarkdown);
        confirmWithMessage.mockResolvedValueOnce(false);
        await expect(askSimpleFetchMode(host)).resolves.toBe("cancelled");
        expect(confirmWithMessage).toHaveBeenCalledOnce();
        expect(confirmWithMessage.mock.calls[0][1]).toContain("example.invalid");
        expect(confirmWithMessage.mock.calls[0][1]).toContain(REMOTE_WINS);
        expect(confirmWithMessage.mock.calls[0][1]).toContain(KEEP_LOCAL);
        expect(files.get(flagPath)).toBe(rememberedMarkdown);
    });

    it("asks before applying saved choices after only the P2P passphrase changes", async () => {
        const { host, files, flagPath, confirmWithMessage, settings } = await createHost();
        Object.assign(settings, {
            remoteType: REMOTE_P2P,
            P2P_roomID: "group",
            P2P_passphrase: "old-private-room-passphrase",
        });
        const { saveFetchSelection } = await import("./redFlag.fetchState");
        await saveFetchSelection(host, REMOTE_WINS, KEEP_LOCAL);
        settings.P2P_passphrase = "new-private-room-passphrase";
        const original = files.get(flagPath);
        confirmWithMessage.mockResolvedValueOnce(false);
        await expect(askSimpleFetchMode(host)).resolves.toBe("cancelled");
        expect(confirmWithMessage).toHaveBeenCalledOnce();
        expect(confirmWithMessage.mock.calls[0][1]).toContain("group");
        expect(confirmWithMessage.mock.calls[0][1]).not.toContain("new-private-room-passphrase");
        expect(files.get(flagPath)).toBe(original);
    });

    it("uses new choices only for this attempt when the flag cannot be read as a selection", async () => {
        const { host, files, flagPath, confirmWithMessage, storage } = await createHost();
        const markdown = "# Recovery notes\n\n<!-- unfinished comment";
        files.set(flagPath, markdown);
        confirmWithMessage
            .mockImplementationOnce(async (_title, _message, buttons) => buttons[0])
            .mockResolvedValueOnce(REMOTE_WINS)
            .mockResolvedValueOnce(KEEP_LOCAL);
        await expect(askSimpleFetchMode(host)).resolves.toMatchObject({ mode: "remote-only" });
        expect(confirmWithMessage).toHaveBeenCalledTimes(3);
        expect(files.get(flagPath)).toBe(markdown);
        expect(storage.writeFileAuto).not.toHaveBeenCalled();
    });
});

describe("Fetch resume decisions", () => {
    it("replaces a valid saved choice only after choosing new options", async () => {
        const { host, files, flagPath, rememberedMarkdown, confirmWithMessage } = await createHost();
        files.set(flagPath, rememberedMarkdown);
        confirmWithMessage
            .mockResolvedValueOnce("Choose again")
            .mockResolvedValueOnce("Compare time and take newer")
            .mockResolvedValueOnce("Keep local files even if deleted on remote");
        await expect(askSimpleFetchMode(host)).resolves.toMatchObject({ mode: "newer-wins" });
        expect(confirmWithMessage).toHaveBeenCalledTimes(3);
        expect(readFetchFlagState(files.get(flagPath)!)).toMatchObject({
            stage1: "Compare time and take newer",
            stage2: "Keep local files even if deleted on remote",
        });
    });

    it("requires confirmation again after a successful explicit reuse", async () => {
        const { host, files, flagPath, rememberedMarkdown, confirmWithMessage } = await createHost();
        files.set(flagPath, rememberedMarkdown);
        confirmWithMessage.mockResolvedValueOnce("Continue with these choices").mockResolvedValueOnce(false);
        await expect(askSimpleFetchMode(host)).resolves.toMatchObject({ mode: "remote-only" });
        await expect(askSimpleFetchMode(host)).resolves.toBe("cancelled");
        expect(confirmWithMessage).toHaveBeenCalledTimes(2);
        expect(confirmWithMessage.mock.calls[0][3]).toBe("Cancel");
    });
});
