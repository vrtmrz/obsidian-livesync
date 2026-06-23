import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, REMOTE_COUCHDB, type RemoteDBSettings, type TweakValues } from "@lib/common/types";
import { ModuleResolvingMismatchedTweaks } from "./ModuleResolveMismatchedTweaks";

function createModule(settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {}) {
    const askSelectStringDialogue = vi.fn(async () => undefined);
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

    Object.defineProperty(core, "services", {
        get() {
            return core._services;
        },
    });

    const module = new ModuleResolvingMismatchedTweaks(core);
    return { module, core, askSelectStringDialogue };
}

describe("ModuleResolvingMismatchedTweaks", () => {
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
});
