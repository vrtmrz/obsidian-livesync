import { afterEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_SETTINGS,
    REMOTE_COUCHDB,
    TweakValuesTemplate,
    type RemoteDBSettings,
    type TweakValues,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { extractObject } from "octagonal-wheels/object";
import { assessTweakCompatibility } from "@vrtmrz/livesync-commonlib/settings";
import { ModuleResolvingMismatchedTweaks } from "./ModuleResolveMismatchedTweaks";
import { setLang } from "@/common/translation";
import {
    CENTRAL_COMPATIBILITY_REJECTION_REASONS,
    REMOTE_RESOURCE_KINDS,
    USER_INITIATED_REPLICATION_AUTHORITY,
    type ReplicationAttemptFailure,
} from "@vrtmrz/livesync-commonlib/replication";

const BASE_TWEAKS = {
    ...extractObject(TweakValuesTemplate, DEFAULT_SETTINGS),
    handleFilenameCaseSensitive: false,
};

function createModule(settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {}) {
    const askSelectStringDialogue = vi.fn(async (..._args: unknown[]): Promise<string | undefined> => undefined);
    const applyPartial = vi.fn(async (_partial: Record<string, unknown>): Promise<void> => undefined);
    const reinitialise = vi.fn(async () => undefined);
    const publication = {};
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
            replicator: {
                acquireActiveReplicatorContext: vi.fn(async () => publication),
            },
        },
        localDatabase: {
            managers: {
                reinitialise,
            },
        },
        settings: {
            ...DEFAULT_SETTINGS,
            handleFilenameCaseSensitive: false,
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
    it("compatibility: offers ordinary application for a missing legacy filename-case setting", async () => {
        const { module, askSelectStringDialogue } = createModule({
            autoAcceptCompatibleTweak: false,
            customChunkSize: 60,
            usePluginSyncV2: true,
            handleFilenameCaseSensitive: false,
        });
        const preferred: TweakValues = {
            ...DEFAULT_SETTINGS,
            customChunkSize: 0,
            usePluginSyncV2: false,
        };
        delete preferred.handleFilenameCaseSensitive;

        await module._checkAndAskResolvingMismatchedTweaks(preferred);

        expect(askSelectStringDialogue.mock.calls[0][1]).toContain("Apply settings to this device");
        expect(askSelectStringDialogue.mock.calls[0][0]).not.toContain("Handle files as Case-Sensitive");
    });

    it("compares the trial configuration when deciding whether to accept compatible remote values", async () => {
        const { module, askSelectStringDialogue } = createModule({
            autoAcceptCompatibleTweak: true,
            hashAlg: "xxhash32",
            tweakModified: 300,
        });
        const trial = {
            ...DEFAULT_SETTINGS,
            hashAlg: "xxhash64",
            tweakModified: 100,
        } as RemoteDBSettings;
        const preferred = { ...trial, hashAlg: "xxhash32", tweakModified: 200 } as TweakValues;

        const result = await module._askUseRemoteConfiguration(trial, preferred);

        expect(result).toEqual({ result: { ...trial, ...preferred }, requireFetch: false });
        expect(askSelectStringDialogue).not.toHaveBeenCalled();
    });

    it("discards remote profile adoption if the active publication changed while awaiting it", async () => {
        const { module, core, askSelectStringDialogue } = createModule({
            autoAcceptCompatibleTweak: false,
            usePluginSyncV2: true,
        });
        let publication = {};
        core._services.replicator.acquireActiveReplicatorContext.mockImplementation(async () => publication);
        askSelectStringDialogue.mockImplementation(async () => {
            publication = {};
            return "Use configured settings";
        });
        const trial = { ...core.settings } as RemoteDBSettings;
        const preferred = { ...trial, usePluginSyncV2: false };

        const result = await module._askUseRemoteConfiguration(trial, preferred);

        expect(askSelectStringDialogue).toHaveBeenCalled();
        expect(result).toEqual({ result: false, requireFetch: false });
    });

    it("discards a decision if the connection settings changed while awaiting it", async () => {
        const { module, core, reinitialise } = createModule({ hashAlg: "xxhash64" });
        const preferred = { ...DEFAULT_SETTINGS, hashAlg: "xxhash32" } as TweakValues;
        core._services.tweakValue = {
            checkAndAskResolvingMismatched: vi.fn(async () => {
                core.settings.couchDB_DBNAME = "another-database";
                return [preferred, false];
            }),
        };
        const updatePreferredRemote = vi.fn(async () => true);

        const result = await module._askResolvingMismatchedTweaks(preferred, updatePreferredRemote);

        expect(result).toBe("IGNORE");
        expect(core.settings.hashAlg).toBe("xxhash64");
        expect(core._services.setting.saveSettingData).not.toHaveBeenCalled();
        expect(reinitialise).not.toHaveBeenCalled();
        expect(updatePreferredRemote).not.toHaveBeenCalled();
    });

    it("discards a decision if its active publication was replaced while awaiting it", async () => {
        const { module, core, reinitialise } = createModule({ hashAlg: "xxhash64" });
        const preferred = { ...BASE_TWEAKS, hashAlg: "xxhash32" } as TweakValues;
        core._services.tweakValue = {
            checkAndAskResolvingMismatched: vi.fn(async () => [preferred, false]),
        };
        core._services.replicator.acquireActiveReplicatorContext.mockResolvedValueOnce({}).mockResolvedValueOnce({});
        const updatePreferredRemote = vi.fn(async () => true);

        await expect(module._askResolvingMismatchedTweaks(preferred, updatePreferredRemote)).resolves.toBe("IGNORE");

        expect(core._services.setting.saveSettingData).not.toHaveBeenCalled();
        expect(reinitialise).not.toHaveBeenCalled();
        expect(updatePreferredRemote).not.toHaveBeenCalled();
    });

    it("uses each direction's assessed reconstruction consequence in the available choices", async () => {
        const { module, core, askSelectStringDialogue } = createModule({ autoAcceptCompatibleTweak: false });
        const preferred = { ...BASE_TWEAKS, encrypt: true };
        const assessment = assessTweakCompatibility(core.settings, preferred);
        const directionalAssessment = {
            ...assessment,
            adoptCurrent: { ...assessment.adoptCurrent, reconstruction: "none" as const },
        };
        askSelectStringDialogue.mockResolvedValueOnce("Update remote database settings");

        const result = await module._checkAndAskResolvingMismatchedTweaks(preferred, directionalAssessment);

        expect(result).toEqual([true, false]);
        expect(askSelectStringDialogue.mock.calls[0][1]).toContain("Apply settings to this device, and fetch again");
        expect(askSelectStringDialogue.mock.calls[0][1]).not.toContain("Apply settings to this device");
    });

    it("keeps explicitly chosen Fetch failures from becoming a successful retry", async () => {
        const { module, core } = createModule({ hashAlg: "xxhash64" });
        const preferred = { ...BASE_TWEAKS, hashAlg: "xxhash32" } as TweakValues;
        core._services.tweakValue = {
            checkAndAskResolvingMismatched: vi.fn(async () => [preferred, true]),
        };
        const failure = new Error("Fetch failed");
        core.rebuilder = {
            $fetchLocal: vi.fn(async () => {
                throw failure;
            }),
        };

        await expect(module._askResolvingMismatchedTweaks(preferred, async () => true)).rejects.toBe(failure);
    });

    it("does not erase an explicit local setting when accepting a partial remote configuration", async () => {
        const { module, core } = createModule({ handleFilenameCaseSensitive: false });
        core._services.tweakValue = {
            checkAndAskResolvingMismatched: vi.fn(async () => [{ customChunkSize: 30 }, false]),
        };

        await expect(module._askResolvingMismatchedTweaks({ customChunkSize: 30 }, async () => true)).resolves.toBe(
            "CHECKAGAIN"
        );
        expect(core.settings.handleFilenameCaseSensitive).toBe(false);
        expect(core.settings.customChunkSize).toBe(30);
    });

    it("preserves a remote recommendation which this device has not advertised", async () => {
        const { module, core } = createModule({ hashAlg: "xxhash64" });
        delete core.settings.readChunksOnline;
        const preferred = { ...BASE_TWEAKS, hashAlg: "xxhash32", readChunksOnline: false } as TweakValues;
        core._services.tweakValue = {
            checkAndAskResolvingMismatched: vi.fn(async () => [true, false]),
        };
        const updateRemote = vi.fn(async () => true);

        await expect(module._askResolvingMismatchedTweaks(preferred, updateRemote)).resolves.toBe("CHECKAGAIN");
        expect(updateRemote).toHaveBeenCalledWith(
            expect.objectContaining({ hashAlg: "xxhash64", readChunksOnline: false })
        );
    });

    it("uses the failed attempt hint and writes only through that exact active publication", async () => {
        const { module, core } = createModule();
        const attemptPreferred = {
            ...BASE_TWEAKS,
            customChunkSize: 60,
        };
        const replacementPreferred = {
            ...BASE_TWEAKS,
            customChunkSize: 99,
        };
        let updatePreferredRemote: ((setting: typeof core.settings) => Promise<boolean>) | undefined;
        const askResolvingMismatched = vi.fn(
            async (_preferred: unknown, update: (setting: typeof core.settings) => Promise<boolean>) => {
                updatePreferredRemote = update;
                return "IGNORE" as const;
            }
        );
        core._services.tweakValue = { askResolvingMismatched };
        core.replicator = {
            tweakSettingsMismatched: true,
            preferredTweakValue: replacementPreferred,
        };
        const failedSetPreferred = vi.fn(async (_setting: typeof core.settings) => undefined);
        const replacementSetPreferred = vi.fn(async (_setting: typeof core.settings) => undefined);
        const failedContext = {
            provider: {},
            replicator: { setPreferredRemoteTweakSettings: failedSetPreferred },
            configurationIdentity: "profile-a",
        };
        const replacementContext = {
            provider: {},
            replicator: { setPreferredRemoteTweakSettings: replacementSetPreferred },
            configurationIdentity: "profile-b",
        };
        let activeContext = failedContext;
        core._services.replicator = {
            runWithActiveReplicatorContext: vi.fn(async (task: (context: typeof failedContext) => unknown) =>
                task(activeContext)
            ),
        };
        const request = {
            context: failedContext,
            setting: core.settings,
            outcome: {
                status: "failed" as const,
                error: new Error("directional replication failed"),
                recoveryHint: {
                    reason: CENTRAL_COMPATIBILITY_REJECTION_REASONS.TWEAK_MISMATCH,
                    preferredTweakValue: attemptPreferred,
                },
            },
            showMessage: true,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        } as unknown as ReplicationAttemptFailure;

        await expect(module._anyAfterConnectCheckFailed(request)).resolves.toBe(true);

        expect(askResolvingMismatched).toHaveBeenCalledWith(
            attemptPreferred,
            expect.any(Function),
            expect.objectContaining({ alignment: "mismatched" })
        );
        const effectiveSetting = { ...core.settings, customChunkSize: 64 };
        await expect(updatePreferredRemote?.(effectiveSetting)).resolves.toBe(true);
        expect(failedSetPreferred).toHaveBeenCalledWith(effectiveSetting);
        expect(failedSetPreferred.mock.calls[0][0]).not.toBe(effectiveSetting);

        activeContext = replacementContext;
        await expect(updatePreferredRemote?.({ ...effectiveSetting, customChunkSize: 72 })).resolves.toBe(false);
        expect(failedSetPreferred).toHaveBeenCalledOnce();
        expect(replacementSetPreferred).not.toHaveBeenCalled();
    });

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
            ...BASE_TWEAKS,
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
            ...BASE_TWEAKS,
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
            ...BASE_TWEAKS,
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
            ...BASE_TWEAKS,
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
            ...BASE_TWEAKS,
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
            ...BASE_TWEAKS,
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
        const updatePreferredRemote = vi.fn(async () => {
            calls.push("set-preferred");
            return true;
        });

        const result = await module._askResolvingMismatchedTweaks(preferred, updatePreferredRemote);

        expect(result).toBe("CHECKAGAIN");
        expect(core.settings).toBe(initialSettings);
        expect(core.settings.hashAlg).toBe("xxhash32");
        expect(calls).toEqual(["save", "reinitialise", "set-preferred"]);
        expect(core.replicator.setPreferredRemoteTweakSettings).not.toHaveBeenCalled();
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
            ...BASE_TWEAKS,
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
