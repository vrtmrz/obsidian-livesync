import { afterEach, describe, expect, it, vi } from "vitest";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { FullScanModes } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner";
import { $msg, setLang } from "@/common/translation";
import { askSimpleFetchMode } from "./redFlag.simpleFetch";

const REMOTE_WINS = "Overwrite all with remote files";
const KEEP_LOCAL = "Keep local files even if not on remote";

function createHost(savedChoice?: string) {
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
    const confirmWithMessage =
        vi.fn<(title: string, message: string, buttons: string[], defaultAction: string) => Promise<string | false>>();
    const host = {
        services: {
            UI: { confirm: { confirmWithMessage } },
            setting: {
                config,
            },
        },
    } as unknown as NecessaryServices<"UI" | "setting", never>;
    return { host, confirmWithMessage, smallConfig, config };
}

afterEach(() => setLang("def"));

describe("Fast Setup translated choices", () => {
    it("uses the current language after the module has loaded and saves stable choice values", async () => {
        const { host, confirmWithMessage, smallConfig } = createHost();
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
        expect(JSON.parse(smallConfig.get("simple-fetch-mode")!)).toEqual({
            stage1: REMOTE_WINS,
            stage2: KEEP_LOCAL,
        });
    });

    it("waits for the saved choice before returning it to the fetch workflow", async () => {
        const { host, confirmWithMessage, smallConfig, config } = createHost();
        let markSaveStarted!: () => void;
        const saveStarted = new Promise<void>((resolve) => {
            markSaveStarted = resolve;
        });
        let finishSave!: () => void;
        const save = new Promise<void>((resolve) => {
            finishSave = resolve;
        });
        config.setValue.mockImplementation(async (key, value) => {
            markSaveStarted();
            await save;
            smallConfig.set(key, value);
        });
        confirmWithMessage.mockImplementation(async (_title, _message, buttons) => buttons[1]);

        const asking = askSimpleFetchMode(host);
        await saveStarted;

        expect(smallConfig.has("simple-fetch-mode")).toBe(false);
        expect(confirmWithMessage).toHaveBeenCalledTimes(2);

        finishSave();
        await expect(asking).resolves.toMatchObject({ mode: "remote-only" });
        expect(JSON.parse(smallConfig.get("simple-fetch-mode")!)).toEqual({
            stage1: REMOTE_WINS,
            stage2: KEEP_LOCAL,
        });
    });

    it("propagates a stored-choice read failure instead of treating it as missing", async () => {
        const { host, confirmWithMessage, config } = createHost();
        config.getValue.mockRejectedValueOnce(new Error("choice read failed"));

        await expect(askSimpleFetchMode(host)).rejects.toThrow("choice read failed");

        expect(confirmWithMessage).not.toHaveBeenCalled();
    });

    it("waits for an invalid optional choice to be deleted before asking again", async () => {
        const { host, confirmWithMessage, smallConfig, config } = createHost("not-json");
        let markDeleteStarted!: () => void;
        const deleteStarted = new Promise<void>((resolve) => {
            markDeleteStarted = resolve;
        });
        let finishDelete!: () => void;
        const deletion = new Promise<void>((resolve) => {
            finishDelete = resolve;
        });
        config.delete.mockImplementation(async (key) => {
            markDeleteStarted();
            await deletion;
            smallConfig.delete(key);
        });
        confirmWithMessage.mockImplementation(async (_title, _message, buttons) => buttons[3]);

        const asking = askSimpleFetchMode(host);
        await deleteStarted;

        expect(confirmWithMessage).not.toHaveBeenCalled();
        expect(smallConfig.has("simple-fetch-mode")).toBe(true);

        finishDelete();
        await expect(asking).resolves.toBe("cancelled");
        expect(smallConfig.has("simple-fetch-mode")).toBe(false);
        expect(confirmWithMessage).toHaveBeenCalledOnce();
    });

    it("restores choices saved by the previous English implementation while displaying Spanish", async () => {
        const savedChoice = JSON.stringify({ stage1: REMOTE_WINS, stage2: KEEP_LOCAL });
        const { host, confirmWithMessage, smallConfig } = createHost(savedChoice);
        setLang("es");

        await expect(askSimpleFetchMode(host)).resolves.toEqual({
            mode: "remote-only",
            options: { mode: FullScanModes.DB_APPLY, extraOnRemote: undefined },
        });

        expect(confirmWithMessage).not.toHaveBeenCalled();
        expect(smallConfig.get("simple-fetch-mode")).toBe(savedChoice);
    });

    it("uses the new language in the second dialogue without changing the first choice", async () => {
        const { host, confirmWithMessage, smallConfig } = createHost();
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
        expect(JSON.parse(smallConfig.get("simple-fetch-mode")!)).toEqual({
            stage1: REMOTE_WINS,
            stage2: KEEP_LOCAL,
        });
    });

    it("recognises the translated cancellation choice", async () => {
        const { host, confirmWithMessage, smallConfig } = createHost();
        setLang("es");
        confirmWithMessage.mockImplementationOnce(async (_title, _message, buttons) => buttons[3]);

        await expect(askSimpleFetchMode(host)).resolves.toBe("cancelled");

        expect(confirmWithMessage.mock.calls[0][2][3]).toBe($msg("Cancel"));
        expect(smallConfig.size).toBe(0);
    });

    it("saves English-compatible values when the module initially loads in Spanish", async () => {
        vi.resetModules();
        const translation = await import("@/common/translation");
        translation.setLang("es");
        const { askSimpleFetchMode: askAfterSpanishStartup } = await import("./redFlag.simpleFetch");
        const { host, confirmWithMessage, smallConfig } = createHost();
        confirmWithMessage.mockImplementation(async (_title, _message, buttons) => buttons[1]);

        try {
            await expect(askAfterSpanishStartup(host)).resolves.toMatchObject({ mode: "remote-only" });
            expect(JSON.parse(smallConfig.get("simple-fetch-mode")!)).toEqual({
                stage1: REMOTE_WINS,
                stage2: KEEP_LOCAL,
            });
        } finally {
            translation.setLang("def");
        }
    });
});
