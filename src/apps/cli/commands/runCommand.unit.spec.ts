import * as processSetting from "@lib/API/processSetting";
import { configURIBase } from "@lib/common/models/shared.const";
import { DEFAULT_SETTINGS } from "@lib/common/types";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "./runCommand";
import type { CLIOptions } from "./types";
import * as commandUtils from "./utils";

function createCoreMock() {
    return {
        services: {
            control: {
                activated: Promise.resolve(),
                applySettings: vi.fn(async () => {}),
            },
            setting: {
                applyPartial: vi.fn(async () => {}),
            },
        },
        serviceModules: {
            fileHandler: {
                dbToStorage: vi.fn(async () => true),
                storeFileToDB: vi.fn(async () => true),
            },
            storageAccess: {
                readFileAuto: vi.fn(async () => ""),
                writeFileAuto: vi.fn(async () => {}),
            },
            databaseFileAccess: {
                fetch: vi.fn(async () => undefined),
            },
        },
    } as any;
}

function makeOptions(command: CLIOptions["command"], commandArgs: string[]): CLIOptions {
    return {
        command,
        commandArgs,
        databasePath: "/tmp/vault",
        verbose: false,
        force: false,
    };
}

async function createSetupURI(passphrase: string): Promise<string> {
    const settings = {
        ...DEFAULT_SETTINGS,
        couchDB_URI: "http://127.0.0.1:5984",
        couchDB_DBNAME: "livesync-test-db",
        couchDB_USER: "user",
        couchDB_PASSWORD: "pass",
        isConfigured: true,
    } as any;
    return await processSetting.encodeSettingsToSetupURI(settings, passphrase);
}

describe("runCommand abnormal cases", () => {
    const context = {
        vaultPath: "/tmp/vault",
        settingsPath: "/tmp/vault/.livesync/settings.json",
    } as any;

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("pull returns false for non-existing path", async () => {
        const core = createCoreMock();
        core.serviceModules.fileHandler.dbToStorage.mockResolvedValue(false);

        const result = await runCommand(makeOptions("pull", ["missing.md", "/tmp/out.md"]), {
            ...context,
            core,
        });

        expect(result).toBe(false);
        expect(core.serviceModules.fileHandler.dbToStorage).toHaveBeenCalled();
    });

    it("pull-rev throws on empty revision", async () => {
        const core = createCoreMock();

        await expect(
            runCommand(makeOptions("pull-rev", ["file.md", "/tmp/out.md", "   "]), {
                ...context,
                core,
            })
        ).rejects.toThrow("pull-rev requires a non-empty revision");
    });

    it("pull-rev returns false for invalid revision", async () => {
        const core = createCoreMock();
        core.serviceModules.databaseFileAccess.fetch.mockResolvedValue(undefined);

        const result = await runCommand(makeOptions("pull-rev", ["file.md", "/tmp/out.md", "9-invalid"]), {
            ...context,
            core,
        });

        expect(result).toBe(false);
        expect(core.serviceModules.databaseFileAccess.fetch).toHaveBeenCalledWith("file.md", "9-invalid", true);
    });

    it("cat-rev throws on empty revision", async () => {
        const core = createCoreMock();

        await expect(
            runCommand(makeOptions("cat-rev", ["file.md", "   "]), {
                ...context,
                core,
            })
        ).rejects.toThrow("cat-rev requires a non-empty revision");
    });

    it("cat-rev returns false for invalid revision", async () => {
        const core = createCoreMock();
        core.serviceModules.databaseFileAccess.fetch.mockResolvedValue(undefined);

        const result = await runCommand(makeOptions("cat-rev", ["file.md", "9-invalid"]), {
            ...context,
            core,
        });

        expect(result).toBe(false);
        expect(core.serviceModules.databaseFileAccess.fetch).toHaveBeenCalledWith("file.md", "9-invalid", true);
    });

    it("push rejects when source file does not exist", async () => {
        const core = createCoreMock();

        await expect(
            runCommand(makeOptions("push", ["/tmp/livesync-missing-src-file.md", "dst.md"]), {
                ...context,
                core,
            })
        ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("setup rejects invalid URI", async () => {
        const core = createCoreMock();

        await expect(
            runCommand(makeOptions("setup", ["https://invalid.example/setup"]), {
                ...context,
                core,
            })
        ).rejects.toThrow(`setup URI must start with ${configURIBase}`);
    });

    it("setup rejects empty passphrase", async () => {
        const core = createCoreMock();
        vi.spyOn(commandUtils, "promptForPassphrase").mockRejectedValue(new Error("Passphrase is required"));

        await expect(
            runCommand(makeOptions("setup", [`${configURIBase}dummy`]), {
                ...context,
                core,
            })
        ).rejects.toThrow("Passphrase is required");
    });

    it("setup accepts URI generated by encodeSettingsToSetupURI", async () => {
        const core = createCoreMock();
        const passphrase = "correct-passphrase";
        const setupURI = await createSetupURI(passphrase);
        vi.spyOn(commandUtils, "promptForPassphrase").mockResolvedValue(passphrase);

        const result = await runCommand(makeOptions("setup", [setupURI]), {
            ...context,
            core,
        });

        expect(result).toBe(true);
        expect(core.services.setting.applyPartial).toHaveBeenCalledTimes(1);
        expect(core.services.control.applySettings).toHaveBeenCalledTimes(1);
        const [appliedSettings, saveImmediately] = core.services.setting.applyPartial.mock.calls[0];
        expect(saveImmediately).toBe(true);
        expect(appliedSettings.couchDB_URI).toBe("http://127.0.0.1:5984");
        expect(appliedSettings.couchDB_DBNAME).toBe("livesync-test-db");
        expect(appliedSettings.isConfigured).toBe(true);
        expect(appliedSettings.useIndexedDBAdapter).toBe(false);
    });

    it("setup rejects encoded URI when passphrase is wrong", async () => {
        const core = createCoreMock();
        const setupURI = await createSetupURI("correct-passphrase");
        vi.spyOn(commandUtils, "promptForPassphrase").mockResolvedValue("wrong-passphrase");

        await expect(
            runCommand(makeOptions("setup", [setupURI]), {
                ...context,
                core,
            })
        ).rejects.toThrow();

        expect(core.services.setting.applyPartial).not.toHaveBeenCalled();
        expect(core.services.control.applySettings).not.toHaveBeenCalled();
    });
});
