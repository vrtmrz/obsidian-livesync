import { afterEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_SETTINGS,
    REMOTE_COUCHDB,
    type RemoteDBSettings,
    type TweakValues,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ModuleResolvingMismatchedTweaks } from "./ModuleResolveMismatchedTweaks";
import { setLang } from "@/common/translation";
import { REMOTE_RESOURCE_KINDS } from "@vrtmrz/livesync-commonlib/replication";

function createModule(settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {}) {
    const askSelectStringDialogue = vi.fn(async (..._args: unknown[]): Promise<string | undefined> => undefined);
    const applyPartial = vi.fn(async (_partial: Record<string, unknown>): Promise<void> => undefined);
    const reinitialise = vi.fn(async () => undefined);
    const core = {
        _services: {
            API: {
                addLog: vi.fn(),
                addCommand: vi.fn(),
                registerWindow: vi.fn(),
                addRibbonIcon: vi.fn(),
                registerProtocolHandler: vi.fn(),
            },
            setting: {
                saveSettingData: vi.fn(async () => undefined),
                applyPartial,
            },
        },
        localDatabase: {
            managers: {
                reinitialise,
            },
        },
        settings: {
            ...DEFAULT_SETTINGS,
            remoteType: REMOTE_COUCHDB,
            ...settingsOverride,
        },
        confirm: {
            askSelectStringDialogue,
        },
    } as any;
    applyPartial.mockImplementation(async (partial: Record<string, unknown>) => {
        core.settings = { ...core.settings, ...partial };
    });

    Object.defineProperty(core, "services", {
        get() {
            return core._services;
        },
    });

    const module = new ModuleResolvingMismatchedTweaks(core);
    return { module, core, askSelectStringDialogue, applyPartial, reinitialise };
}

describe("ModuleResolvingMismatchedTweaks", () => {
    it("returns an unconfigured remote result without a separate connection preflight", async () => {
        const { module, core } = createModule();
        const read = vi.fn(async () => ({
            status: "not-configured" as const,
            reason: "milestone-missing" as const,
        }));
        const dispose = vi.fn(async () => undefined);
        const createRemoteResource = vi.fn(async () => ({ read, dispose }));
        core._services.replicator = {
            createRemoteResource,
            getNewReplicator: vi.fn(() => Promise.reject(new Error("must not borrow a Replicator"))),
        };

        await expect(module._fetchRemotePreferredTweakValues(core.settings)).resolves.toEqual({
            status: "not-configured",
            reason: "milestone-missing",
        });
        expect(createRemoteResource).toHaveBeenCalledWith(REMOTE_RESOURCE_KINDS.PREFERRED_TWEAK, core.settings);
        expect(read).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
        expect(core._services.replicator.getNewReplicator).not.toHaveBeenCalled();
    });

    it("returns unsupported when no replicator implements the remote type", async () => {
        const { module, core } = createModule();
        core._services.replicator = {
            createRemoteResource: vi.fn(async () => undefined),
        };

        await expect(module._fetchRemotePreferredTweakValues(core.settings)).resolves.toEqual({
            status: "unsupported",
        });
    });

    it("disposes the preferred-tweak probe when reading fails", async () => {
        const { module, core } = createModule();
        const error = new Error("remote unavailable");
        const dispose = vi.fn(async () => undefined);
        core._services.replicator = {
            createRemoteResource: vi.fn(async () => ({
                read: vi.fn(async () => {
                    throw error;
                }),
                dispose,
            })),
        };

        await expect(module._fetchRemotePreferredTweakValues(core.settings)).resolves.toEqual({
            status: "unavailable",
            error,
        });
        expect(dispose).toHaveBeenCalledOnce();
    });

    it("should enable and auto-accept compatible mismatches when the preference is undefined", async () => {
        const { module, core, askSelectStringDialogue, applyPartial } = createModule({
            autoAcceptCompatibleTweak: undefined,
            hashAlg: "xxhash64",
            tweakModified: 100,
        });
        const initialSettings = core.settings;

        const preferred = {
            ...(DEFAULT_SETTINGS as unknown as TweakValues),
            hashAlg: "xxhash32",
            tweakModified: 200,
        } as Partial<TweakValues>;

        const [conf, rebuild] = await module._checkAndAskResolvingMismatchedTweaks(preferred);

        expect(conf).toEqual(preferred);
        expect(rebuild).toBe(false);
        expect(core.settings).toBe(initialSettings);
        expect(core.settings.autoAcceptCompatibleTweak).toBe(true);
        expect(core._services.setting.saveSettingData).toHaveBeenCalledTimes(1);
        expect(applyPartial).not.toHaveBeenCalled();
        expect(askSelectStringDialogue).not.toHaveBeenCalled();
    });

    it("should auto-accept compatible mismatches on connect check using newer remote tweakModified", async () => {
        const { module, askSelectStringDialogue } = createModule({
            autoAcceptCompatibleTweak: true,
            hashAlg: "xxhash64",
            tweakModified: 100,
        });

        const preferred = {
            ...(DEFAULT_SETTINGS as unknown as TweakValues),
            hashAlg: "xxhash32",
            tweakModified: 200,
        } as Partial<TweakValues>;

        const [conf, rebuild] = await module._checkAndAskResolvingMismatchedTweaks(preferred);

        expect(conf).toEqual(preferred);
        expect(rebuild).toBe(false);
        expect(askSelectStringDialogue).not.toHaveBeenCalled();
    });

    it.each([
        { label: "neither side has a recorded time", currentModified: 0, preferredModified: 0 },
        { label: "the recorded times are equal", currentModified: 200, preferredModified: 200 },
    ])("should use the remote compatible value when $label", async ({ currentModified, preferredModified }) => {
        const { module, askSelectStringDialogue } = createModule({
            autoAcceptCompatibleTweak: true,
            hashAlg: "xxhash64",
            tweakModified: currentModified,
        });
        const preferred = {
            ...(DEFAULT_SETTINGS as unknown as TweakValues),
            hashAlg: "xxhash32",
            tweakModified: preferredModified,
        } as Partial<TweakValues>;

        const [conf, rebuild] = await module._checkAndAskResolvingMismatchedTweaks(preferred);

        expect(conf).toEqual(preferred);
        expect(rebuild).toBe(false);
        expect(askSelectStringDialogue).not.toHaveBeenCalled();
    });

    it("should fallback to manual confirmation when mismatches are mixed on connect check", async () => {
        const { module, askSelectStringDialogue } = createModule({
            autoAcceptCompatibleTweak: true,
            hashAlg: "xxhash64",
            encrypt: false,
            tweakModified: 100,
        });

        const preferred = {
            ...(DEFAULT_SETTINGS as unknown as TweakValues),
            hashAlg: "xxhash32",
            encrypt: true,
            tweakModified: 200,
        } as Partial<TweakValues>;

        const [conf, rebuild] = await module._checkAndAskResolvingMismatchedTweaks(preferred);

        expect(conf).toBe(false);
        expect(rebuild).toBe(false);
        expect(askSelectStringDialogue).toHaveBeenCalledTimes(1);
    });

    it("should fetch after applying a compatible remote setting when the user selects the rebuild option", async () => {
        const { module, askSelectStringDialogue } = createModule({
            autoAcceptCompatibleTweak: false,
            hashAlg: "xxhash64",
        });
        askSelectStringDialogue.mockResolvedValueOnce("Apply settings to this device, and fetch again");

        const preferred = {
            ...(DEFAULT_SETTINGS as unknown as TweakValues),
            hashAlg: "xxhash32",
        } as TweakValues;

        const [conf, rebuild] = await module._checkAndAskResolvingMismatchedTweaks(preferred);

        expect(conf).toEqual(preferred);
        expect(rebuild).toBe(true);
    });

    it("should auto-accept compatible mismatches on remote-config check using newer local tweakModified", async () => {
        const { module, askSelectStringDialogue } = createModule({
            autoAcceptCompatibleTweak: true,
            hashAlg: "xxhash64",
            tweakModified: 300,
        });

        const trialSetting = {
            ...DEFAULT_SETTINGS,
            remoteType: REMOTE_COUCHDB,
            hashAlg: "xxhash64",
            tweakModified: 300,
        } as RemoteDBSettings;

        const preferred = {
            ...(trialSetting as unknown as TweakValues),
            hashAlg: "xxhash32",
            tweakModified: 200,
        } as TweakValues;

        const result = await module._askUseRemoteConfiguration(trialSetting, preferred);

        expect(result).toEqual({ result: false, requireFetch: false });
        expect(askSelectStringDialogue).not.toHaveBeenCalled();
    });

    it("should apply remote compatible settings in place and reinitialise managers before retrying", async () => {
        const { module, core, reinitialise } = createModule({
            autoAcceptCompatibleTweak: true,
            hashAlg: "xxhash64",
            tweakModified: 100,
        });
        const initialSettings = core.settings;
        const preferred = {
            ...(DEFAULT_SETTINGS as unknown as TweakValues),
            hashAlg: "xxhash32",
            tweakModified: 200,
        } as TweakValues;
        const calls: string[] = [];
        core._services.tweakValue = {
            checkAndAskResolvingMismatched: vi.fn(async () => [preferred, false]),
        };
        core._services.setting.saveSettingData = vi.fn(async () => {
            calls.push("save");
        });
        core.replicator = {
            tweakSettingsMismatched: true,
            preferredTweakValue: preferred,
            setPreferredRemoteTweakSettings: vi.fn(async () => {
                calls.push("set-preferred");
            }),
        };
        reinitialise.mockImplementation(async () => {
            calls.push("reinitialise");
        });

        const result = await module._askResolvingMismatchedTweaks();

        expect(result).toBe("CHECKAGAIN");
        expect(core.settings).toBe(initialSettings);
        expect(core.settings.hashAlg).toBe("xxhash32");
        expect(calls).toEqual(["save", "reinitialise", "set-preferred"]);
    });
});

describe("ModuleResolvingMismatchedTweaks setting labels", () => {
    afterEach(() => setLang("def"));

    async function renderMismatchTable() {
        const { module, askSelectStringDialogue } = createModule({
            autoAcceptCompatibleTweak: true,
            hashAlg: "xxhash64",
            encrypt: false,
            tweakModified: 100,
        });
        const preferred = {
            ...(DEFAULT_SETTINGS as unknown as TweakValues),
            hashAlg: "xxhash32",
            encrypt: true,
            tweakModified: 200,
        } as Partial<TweakValues>;

        await module._checkAndAskResolvingMismatchedTweaks(preferred);

        return String(askSelectStringDialogue.mock.calls[0]?.[0] ?? "");
    }

    it("localises the setting names and keeps the status suffix", async () => {
        setLang("zh-tw");

        const message = await renderMismatchTable();

        expect(message).toContain("chunk ID 的雜湊演算法 (Experimental)");
        expect(message).toContain("端對端加密");
        expect(message).not.toContain("The Hash algorithm for chunk IDs");
    });

    it("leaves English unchanged", async () => {
        const message = await renderMismatchTable();

        expect(message).toContain("The Hash algorithm for chunk IDs (Experimental)");
        expect(message).toContain("End-to-End Encryption");
    });
});
