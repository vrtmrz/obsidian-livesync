import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, REMOTE_COUCHDB, type RemoteDBSettings, type TweakValues } from "@lib/common/types";
import {
    useMismatchedTweaksResolver,
    checkAndAskResolvingMismatchedTweaksHandler,
    askUseRemoteConfigurationHandler,
    valueToString,
    selectNewerTweakSide,
    onBeforeSaveSettingDataHandler,
    anyAfterConnectCheckFailedHandler,
    askResolvingMismatchedTweaksHandler,
    fetchRemotePreferredTweakValuesHandler,
    checkAndAskUseRemoteConfigurationHandler,
} from "./mismatchedTweaksResolver";
import type { NecessaryObsidianFeature } from "@/types";
import { $msg } from "@lib/common/i18n";

function createFeature(settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {}) {
    const askSelectStringDialogue = vi.fn(async (): Promise<string | undefined> => undefined);

    const applyPartial = vi.fn((partial) => {
        Object.assign(host.services.setting.settings, partial);
    });
    const saveSettingData = vi.fn();

    const createEventMock = () => {
        const fn = vi.fn();
        (fn as any).setHandler = vi.fn();
        (fn as any).addHandler = vi.fn();
        return fn;
    };

    const host = {
        services: {
            setting: {
                settings: {
                    ...DEFAULT_SETTINGS,
                    remoteType: REMOTE_COUCHDB,
                    ...settingsOverride,
                },
                applyPartial,
                saveSettingData,
                onBeforeSaveSettingData: { addHandler: vi.fn() },
            },
            tweakValue: {
                fetchRemotePreferred: createEventMock(),
                checkAndAskResolvingMismatched: createEventMock(),
                askResolvingMismatched: createEventMock(),
                checkAndAskUseRemoteConfiguration: createEventMock(),
                askUseRemoteConfiguration: createEventMock(),
            },
            replication: {
                checkConnectionFailure: { addHandler: vi.fn() },
            },
            replicator: {
                getActiveReplicator: vi.fn(),
                getNewReplicator: vi.fn(),
            },
            UI: {
                confirm: {
                    askSelectStringDialogue,
                },
            },
        },
        serviceModules: {
            rebuilder: {
                $rebuildRemote: vi.fn(),
                $fetchLocal: vi.fn(),
            },
        },
    } as unknown as NecessaryObsidianFeature<
        "setting" | "tweakValue" | "replication" | "replicator" | "UI",
        "rebuilder"
    >;

    const state = { hasNotifiedAutoAcceptCompatibleUndefined: false };

    const checkAndAskResolvingMismatchedTweaks = checkAndAskResolvingMismatchedTweaksHandler.bind(null, host, state);
    const askUseRemoteConfiguration = askUseRemoteConfigurationHandler.bind(null, host, state);

    return { checkAndAskResolvingMismatchedTweaks, askUseRemoteConfiguration, askSelectStringDialogue, host };
}

describe("useMismatchedTweaksResolver", () => {
    it("should register mismatched tweaks resolver handlers", () => {
        const { host } = createFeature();
        useMismatchedTweaksResolver(host);
        expect(host.services.setting.onBeforeSaveSettingData.addHandler).toHaveBeenCalled();
        expect((host.services.tweakValue.fetchRemotePreferred as any).setHandler).toHaveBeenCalled();
        expect((host.services.tweakValue.checkAndAskResolvingMismatched as any).setHandler).toHaveBeenCalled();
    });

    it("should auto-accept compatible mismatches on connect check using newer remote tweakModified", async () => {
        const { checkAndAskResolvingMismatchedTweaks, askSelectStringDialogue } = createFeature({
            autoAcceptCompatibleTweak: true,
            hashAlg: "xxhash64",
            tweakModified: 100,
        });

        const preferred = {
            ...(DEFAULT_SETTINGS as unknown as TweakValues),
            hashAlg: "xxhash32",
            tweakModified: 200,
        } as Partial<TweakValues>;

        const [conf, rebuild] = await checkAndAskResolvingMismatchedTweaks(preferred as any);

        expect(conf).toEqual(preferred);
        expect(rebuild).toBe(false);
        expect(askSelectStringDialogue).not.toHaveBeenCalled();
    });

    it("should fallback to manual confirmation when mismatches are mixed on connect check", async () => {
        const { checkAndAskResolvingMismatchedTweaks, askSelectStringDialogue } = createFeature({
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

        const [conf, rebuild] = await checkAndAskResolvingMismatchedTweaks(preferred as any);

        expect(conf).toBe(false);
        expect(rebuild).toBe(false);
        expect(askSelectStringDialogue).toHaveBeenCalledTimes(1);
    });

    it("should auto-accept compatible mismatches on remote-config check using newer local tweakModified", async () => {
        const { askUseRemoteConfiguration, askSelectStringDialogue } = createFeature({
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

        const result = await askUseRemoteConfiguration(trialSetting, preferred);

        expect(result).toEqual({ result: false, requireFetch: false });
        expect(askSelectStringDialogue).not.toHaveBeenCalled();
    });

    describe("valueToString", () => {
        it("should convert boolean, object, and other types to string", () => {
            expect(valueToString(true)).toBe("true");
            expect(valueToString(false)).toBe("false");
            expect(valueToString({ foo: "bar" })).toBe('{"foo":"bar"}');
            expect(valueToString("test")).toBe("test");
            expect(valueToString(123)).toBe("123");
            expect(valueToString(undefined)).toBe("undefined");
        });
    });

    describe("selectNewerTweakSide", () => {
        it("should select the newer tweak side based on modification time", () => {
            expect(selectNewerTweakSide({ tweakModified: 100 } as any, { tweakModified: 200 })).toBe("REMOTE");
            expect(selectNewerTweakSide({ tweakModified: 200 } as any, { tweakModified: 100 })).toBe("CURRENT");
            expect(selectNewerTweakSide({ tweakModified: 100 } as any, { tweakModified: 100 })).toBe("REMOTE");
            expect(selectNewerTweakSide({ tweakModified: 0 } as any, { tweakModified: 0 })).toBe("REMOTE");
            expect(selectNewerTweakSide({} as any, { tweakModified: 100 })).toBe("REMOTE");
            expect(selectNewerTweakSide({ tweakModified: 100 } as any, {})).toBe("CURRENT");
        });
    });

    describe("onBeforeSaveSettingDataHandler", () => {
        it("should add tweakModified when tweaks are changed", async () => {
            const next = { hashAlg: "xxhash32", tweakModified: 100 } as any;
            const prev = { hashAlg: "xxhash64", tweakModified: 100 } as any;
            const res = await onBeforeSaveSettingDataHandler(next, prev);
            expect(res).toBeDefined();
            expect(res!.tweakModified).toBeGreaterThan(0);
        });

        it("should return undefined if no tweaks are changed", async () => {
            const next = { hashAlg: "xxhash64", tweakModified: 100 } as any;
            const prev = { hashAlg: "xxhash64", tweakModified: 100 } as any;
            const res = await onBeforeSaveSettingDataHandler(next, prev);
            expect(res).toBeUndefined();
        });
    });

    describe("anyAfterConnectCheckFailedHandler", () => {
        it("should return false if no tweaks mismatch", async () => {
            const host = createFeature().host;
            host.services.replicator.getActiveReplicator = vi.fn().mockReturnValue(null);
            const res = await anyAfterConnectCheckFailedHandler(host);
            expect(res).toBe(false);
        });

        it("should check and ask resolving mismatched", async () => {
            const host = createFeature().host;
            const mockReplicator = {
                tweakSettingsMismatched: true,
                preferredTweakValue: { tweakModified: 200 },
            };
            host.services.replicator.getActiveReplicator = vi.fn().mockReturnValue(mockReplicator);
            (host.services.tweakValue.askResolvingMismatched as any) = vi.fn().mockResolvedValue("CHECKAGAIN");

            const res = await anyAfterConnectCheckFailedHandler(host);
            expect(res).toBe("CHECKAGAIN");
            expect(host.services.tweakValue.askResolvingMismatched).toHaveBeenCalledWith(
                mockReplicator.preferredTweakValue
            );
        });
    });

    describe("askResolvingMismatchedTweaksHandler", () => {
        it("should return OK if no mismatch", async () => {
            const host = createFeature().host;
            const mockReplicator = { tweakSettingsMismatched: false };
            host.services.replicator.getActiveReplicator = vi.fn().mockReturnValue(mockReplicator);

            const res = await askResolvingMismatchedTweaksHandler(host);
            expect(res).toBe("OK");
        });

        it("should apply conf=true (current/mine) and rebuild remote", async () => {
            const host = createFeature().host;
            const mockReplicator = {
                tweakSettingsMismatched: true,
                preferredTweakValue: { tweakModified: 200 },
                setPreferredRemoteTweakSettings: vi.fn().mockResolvedValue(true),
            };
            host.services.replicator.getActiveReplicator = vi.fn().mockReturnValue(mockReplicator);
            (host.services.tweakValue.checkAndAskResolvingMismatched as any) = vi.fn().mockResolvedValue([true, true]);
            host.serviceModules.rebuilder.$rebuildRemote = vi.fn().mockResolvedValue(true);

            const res = await askResolvingMismatchedTweaksHandler(host);
            expect(res).toBe("CHECKAGAIN");
            expect(mockReplicator.setPreferredRemoteTweakSettings).toHaveBeenCalledWith(host.services.setting.settings);
            expect(host.serviceModules.rebuilder.$rebuildRemote).toHaveBeenCalled();
        });

        it("should apply conf object (remote/preferred) and fetch local", async () => {
            const host = createFeature().host;
            const mockReplicator = {
                tweakSettingsMismatched: true,
                preferredTweakValue: { tweakModified: 200 },
                setPreferredRemoteTweakSettings: vi.fn().mockResolvedValue(true),
            };
            host.services.replicator.getActiveReplicator = vi.fn().mockReturnValue(mockReplicator);
            const confObj = { hashAlg: "xxhash32" };
            (host.services.tweakValue.checkAndAskResolvingMismatched as any) = vi
                .fn()
                .mockResolvedValue([confObj, true]);
            host.serviceModules.rebuilder.$fetchLocal = vi.fn().mockResolvedValue(true);

            const res = await askResolvingMismatchedTweaksHandler(host);
            expect(res).toBe("CHECKAGAIN");
            expect(host.services.setting.settings.hashAlg).toBe("xxhash32");
            expect(mockReplicator.setPreferredRemoteTweakSettings).toHaveBeenCalled();
            expect(host.services.setting.saveSettingData).toHaveBeenCalled();
            expect(host.serviceModules.rebuilder.$fetchLocal).toHaveBeenCalled();
        });
    });

    describe("fetchRemotePreferredTweakValuesHandler", () => {
        it("should connect and fetch remote preferred tweaks", async () => {
            const host = createFeature().host;
            const mockReplicator = {
                tryConnectRemote: vi.fn().mockResolvedValue(true),
                getRemotePreferredTweakValues: vi.fn().mockResolvedValue({ tweakModified: 123 }),
            };
            (host.services.replicator as any).getNewReplicator = vi.fn().mockResolvedValue(mockReplicator);

            const res = await fetchRemotePreferredTweakValuesHandler(host, {} as any);
            expect(res).toEqual({ tweakModified: 123 });
        });

        it("should return false if connect or fetch fails", async () => {
            const host = createFeature().host;
            const mockReplicator = {
                tryConnectRemote: vi.fn().mockResolvedValue(false),
            };
            (host.services.replicator as any).getNewReplicator = vi.fn().mockResolvedValue(mockReplicator);

            const res = await fetchRemotePreferredTweakValuesHandler(host, {} as any);
            expect(res).toBe(false);
        });
    });

    describe("checkAndAskUseRemoteConfigurationHandler", () => {
        it("should skip P2P remote configuration check", async () => {
            const host = createFeature().host;
            const res = await checkAndAskUseRemoteConfigurationHandler(host, { remoteType: "p2p" } as any);
            expect(res).toEqual({ result: false, requireFetch: false });
        });

        it("should fetch remote preferred configuration and ask use remote configuration", async () => {
            const host = createFeature().host;
            const trial = { remoteType: REMOTE_COUCHDB } as any;
            (host.services.tweakValue.fetchRemotePreferred as any) = vi.fn().mockResolvedValue({ tweakModified: 123 });
            (host.services.tweakValue.askUseRemoteConfiguration as any) = vi
                .fn()
                .mockResolvedValue({ result: true, requireFetch: true });

            const res = await checkAndAskUseRemoteConfigurationHandler(host, trial);
            expect(res).toEqual({ result: true, requireFetch: true });
            expect(host.services.tweakValue.fetchRemotePreferred).toHaveBeenCalledWith(trial);
            expect(host.services.tweakValue.askUseRemoteConfiguration).toHaveBeenCalledWith(trial, {
                tweakModified: 123,
            });
        });
    });

    describe("shouldAutoAcceptCompatibleLossy - undefined case", () => {
        it("should prompt user when autoAcceptCompatibleTweak is undefined", async () => {
            const { host, askSelectStringDialogue } = createFeature({
                autoAcceptCompatibleTweak: undefined,
                hashAlg: "xxhash64",
                tweakModified: 100,
            });
            askSelectStringDialogue.mockResolvedValue($msg("TweakMismatchResolve.Action.EnableAutoAcceptCompatible"));

            const preferred = {
                ...(DEFAULT_SETTINGS as unknown as TweakValues),
                hashAlg: "xxhash32",
                tweakModified: 200,
            } as Partial<TweakValues>;

            const state = { hasNotifiedAutoAcceptCompatibleUndefined: false };
            const [conf, rebuild] = await checkAndAskResolvingMismatchedTweaksHandler(host, state, preferred as any);

            expect(conf).toEqual(preferred);
            expect(rebuild).toBe(false);
            expect(host.services.setting.applyPartial).toHaveBeenCalledWith({ autoAcceptCompatibleTweak: true }, true);
        });
    });

    describe("askUseRemoteConfigurationHandler", () => {
        it("should return false if no difference", async () => {
            const { askUseRemoteConfiguration } = createFeature({
                hashAlg: "xxhash64",
            });
            const trialSetting = { hashAlg: "xxhash64" } as any;
            const preferred = { hashAlg: "xxhash64" } as any;
            const res = await askUseRemoteConfiguration(trialSetting, preferred);
            expect(res).toEqual({ result: false, requireFetch: false });
        });

        it("should prompt user and return configuration if they accept remote config", async () => {
            const { askUseRemoteConfiguration, askSelectStringDialogue } = createFeature({
                hashAlg: "xxhash64",
            });
            const trialSetting = { hashAlg: "xxhash64" } as any;
            const preferred = { hashAlg: "xxhash32" } as any;

            askSelectStringDialogue.mockResolvedValue($msg("TweakMismatchResolve.Action.UseConfigured"));

            const res = await askUseRemoteConfiguration(trialSetting, preferred);
            expect(res).toEqual({
                result: { hashAlg: "xxhash32" },
                requireFetch: false,
            });
        });

        it("should prompt user and return false if they dismiss", async () => {
            const { askUseRemoteConfiguration, askSelectStringDialogue } = createFeature({
                hashAlg: "xxhash64",
            });
            const trialSetting = { hashAlg: "xxhash64" } as any;
            const preferred = { hashAlg: "xxhash32" } as any;

            askSelectStringDialogue.mockResolvedValue($msg("TweakMismatchResolve.Action.Dismiss"));

            const res = await askUseRemoteConfiguration(trialSetting, preferred);
            expect(res).toEqual({
                result: false,
                requireFetch: false,
            });
        });
    });
});
