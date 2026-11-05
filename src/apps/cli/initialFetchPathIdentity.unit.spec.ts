import { describe, expect, it, vi } from "vitest";
import { REMOTE_COUCHDB, REMOTE_MINIO, REMOTE_P2P } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createDefaultCliSettings } from "./cliSettingsDefaults";
import { resolveInitialFetchPathIdentity } from "./initialFetchPathIdentity";

function fixture() {
    const settings = {
        ...createDefaultCliSettings(),
        couchDB_URI: "https://db.test",
        couchDB_DBNAME: "vault",
        endpoint: "https://objects.test",
        bucket: "vault",
    };
    const probe = {
        check: vi.fn(),
        getStatus: vi.fn(),
        inspectPathIdentity: vi.fn(async () => ({
            status: "configured" as const,
            pathNormalizationVersion: 0 as const,
        })),
        dispose: vi.fn(async () => undefined),
    };
    return { settings, probe, createProbe: vi.fn(async () => probe) };
}

describe("initial CLI Fetch path identity", () => {
    it.each([REMOTE_COUCHDB, REMOTE_MINIO])("adopts a legacy %s remote before the first Fetch", async (remoteType) => {
        const { settings, probe, createProbe } = fixture();
        settings.remoteType = remoteType;
        await expect(resolveInitialFetchPathIdentity(settings, createProbe)).resolves.toBe(0);
        expect(settings.pathNormalizationVersion).toBe(1);
        expect(probe.dispose).toHaveBeenCalledOnce();
    });
    it("leaves an already configured device unchanged", async () => {
        const { settings, createProbe } = fixture();
        settings.isConfigured = true;
        await expect(resolveInitialFetchPathIdentity(settings, createProbe)).resolves.toBeUndefined();
        expect(createProbe).not.toHaveBeenCalled();
    });
    it.each(["unconfigured", "p2p"])("does not infer identity for %s settings", async (kind) => {
        const { settings, createProbe } = fixture();
        if (kind === "p2p") settings.remoteType = REMOTE_P2P;
        else settings.couchDB_URI = "";
        await expect(resolveInitialFetchPathIdentity(settings, createProbe)).resolves.toBeUndefined();
        expect(createProbe).not.toHaveBeenCalled();
    });
});
