import { describe, expect, it } from "vitest";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";
import {
    getCouchDBReplicatorConfigurationIdentity,
    getObjectStorageReplicatorConfigurationIdentity,
} from "./replicatorConfigurationIdentity";

describe("active Replicator configuration identity", () => {
    function configuredSettings(overrides: Partial<ObsidianLiveSyncSettings> = {}): ObsidianLiveSyncSettings {
        return Object.assign(createNewVaultSettings(), {
            activeConfigurationId: "profile-a",
            couchDB_URI: "https://couch.example.test/base",
            couchDB_USER: "alice",
            couchDB_PASSWORD: "secret-a",
            couchDB_DBNAME: "vault",
            couchDB_CustomHeaders: "X-Second: two\nX-First: one",
            endpoint: "https://objects.example.test/base",
            accessKey: "alice",
            secretKey: "secret-a",
            bucket: "vault",
            bucketPrefix: "notes/",
            region: "auto",
            bucketCustomHeaders: "X-Second: two\nX-First: one",
            encrypt: true,
            passphrase: "encryption-a",
            useDynamicIterationCount: false,
            permitEmptyPassphrase: false,
            enableCompression: false,
            ...overrides,
        });
    }

    it.each([
        ["couchDB_URI", "https://other.example.test/base"],
        ["couchDB_DBNAME", "other-vault"],
        ["couchDB_USER", "bob"],
        ["couchDB_PASSWORD", "secret-b"],
        ["couchDB_CustomHeaders", "X-First: changed"],
        ["useRequestAPI", true],
        ["disableRequestURI", true],
        ["encrypt", false],
        ["passphrase", "encryption-b"],
        ["useDynamicIterationCount", true],
        ["E2EEAlgorithm", ""],
        ["permitEmptyPassphrase", true],
        ["enableCompression", true],
    ] satisfies Array<[keyof ObsidianLiveSyncSettings, ObsidianLiveSyncSettings[keyof ObsidianLiveSyncSettings]]>)(
        "detects a CouchDB %s change",
        (key, value) => {
            const settings = configuredSettings();
            expect(getCouchDBReplicatorConfigurationIdentity({ ...settings, [key]: value })).not.toBe(
                getCouchDBReplicatorConfigurationIdentity(settings)
            );
        }
    );

    it("ignores persisted central profile identity when the effective connection settings match", () => {
        const settings = configuredSettings({ activeConfigurationId: "profile-a" });
        const otherProfile = { ...settings, activeConfigurationId: "profile-b" };

        expect(getCouchDBReplicatorConfigurationIdentity(otherProfile)).toBe(
            getCouchDBReplicatorConfigurationIdentity(settings)
        );
        expect(getObjectStorageReplicatorConfigurationIdentity(otherProfile)).toBe(
            getObjectStorageReplicatorConfigurationIdentity(settings)
        );
    });

    it("projects only the active CouchDB authentication mode", () => {
        const basic = configuredSettings({ useJWT: false, jwtKey: "inactive-a" });
        expect(getCouchDBReplicatorConfigurationIdentity({ ...basic, jwtKey: "inactive-b" })).toBe(
            getCouchDBReplicatorConfigurationIdentity(basic)
        );

        const jwt = configuredSettings({
            useJWT: true,
            jwtAlgorithm: "HS256",
            jwtKey: "jwt-a",
            jwtKid: "kid-a",
            jwtSub: "subject-a",
            jwtExpDuration: 5,
        });
        expect(getCouchDBReplicatorConfigurationIdentity({ ...jwt, couchDB_PASSWORD: "inactive" })).toBe(
            getCouchDBReplicatorConfigurationIdentity(jwt)
        );
        expect(getCouchDBReplicatorConfigurationIdentity({ ...jwt, jwtKey: "jwt-b" })).not.toBe(
            getCouchDBReplicatorConfigurationIdentity(jwt)
        );
    });

    it.each([
        ["endpoint", "https://other.example.test/base"],
        ["bucket", "other-vault"],
        ["bucketPrefix", "archive/"],
        ["region", "eu-west-1"],
        ["accessKey", "bob"],
        ["secretKey", "secret-b"],
        ["forcePathStyle", false],
        ["useCustomRequestHandler", true],
        ["bucketCustomHeaders", "X-First: changed"],
        ["encrypt", false],
        ["passphrase", "encryption-b"],
        ["useDynamicIterationCount", true],
        ["E2EEAlgorithm", ""],
        ["permitEmptyPassphrase", true],
    ] satisfies Array<[keyof ObsidianLiveSyncSettings, ObsidianLiveSyncSettings[keyof ObsidianLiveSyncSettings]]>)(
        "detects an Object Storage %s change",
        (key, value) => {
            const settings = configuredSettings();
            expect(getObjectStorageReplicatorConfigurationIdentity({ ...settings, [key]: value })).not.toBe(
                getObjectStorageReplicatorConfigurationIdentity(settings)
            );
        }
    );

    it("normalises endpoint and header representation without using the setup URI grammar", () => {
        const settings = configuredSettings();
        const couchIdentity = getCouchDBReplicatorConfigurationIdentity(settings);
        const objectStorageIdentity = getObjectStorageReplicatorConfigurationIdentity(settings);

        expect(
            getCouchDBReplicatorConfigurationIdentity({
                ...settings,
                couchDB_URI: "https://couch.example.test:443/base/",
                couchDB_CustomHeaders: "X-First: one\nX-Second: two",
            })
        ).toBe(couchIdentity);
        expect(
            getObjectStorageReplicatorConfigurationIdentity({
                ...settings,
                endpoint: "https://objects.example.test:443/base/",
                bucketCustomHeaders: "X-First: one\nX-Second: two",
            })
        ).toBe(objectStorageIdentity);
    });

    it("ignores inactive remote-security credentials", () => {
        const settings = configuredSettings({ encrypt: false, passphrase: "inactive-a" });

        expect(
            getCouchDBReplicatorConfigurationIdentity({
                ...settings,
                passphrase: "inactive-b",
                useDynamicIterationCount: !settings.useDynamicIterationCount,
                E2EEAlgorithm: "",
                permitEmptyPassphrase: !settings.permitEmptyPassphrase,
            })
        ).toBe(getCouchDBReplicatorConfigurationIdentity(settings));
        expect(
            getObjectStorageReplicatorConfigurationIdentity({
                ...settings,
                passphrase: "inactive-b",
                useDynamicIterationCount: !settings.useDynamicIterationCount,
                E2EEAlgorithm: "",
                permitEmptyPassphrase: !settings.permitEmptyPassphrase,
            })
        ).toBe(getObjectStorageReplicatorConfigurationIdentity(settings));
    });

    it("keeps malformed endpoints deterministic and scoped", () => {
        const settings = configuredSettings({ couchDB_URI: "not a URL", endpoint: "also not a URL" });

        expect(() => getCouchDBReplicatorConfigurationIdentity(settings)).not.toThrow();
        expect(() => getObjectStorageReplicatorConfigurationIdentity(settings)).not.toThrow();
        expect(
            getCouchDBReplicatorConfigurationIdentity({ ...settings, couchDB_URI: "different invalid URL" })
        ).not.toBe(getCouchDBReplicatorConfigurationIdentity(settings));
        const unrelatedPluginChange = { ...settings, displayLanguage: "ja" };
        expect(getObjectStorageReplicatorConfigurationIdentity(unrelatedPluginChange)).toBe(
            getObjectStorageReplicatorConfigurationIdentity(settings)
        );
    });
});
