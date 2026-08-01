import { describe, expect, it } from "vitest";

import { serialisePostgRESTConnectionURI } from "@vrtmrz/livesync-commonlib/journal-storage";
import { postgRESTJournalFormFromSettings, postgRESTSyncSettingsFromForm } from "./postgRESTJournalSettings.ts";

const repositoryId = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("PostgREST Journal settings", () => {
    it("round-trips client connection fields with the fixed Adaptive protocol", () => {
        const settings = {
            postgrestActiveConnectionURI: serialisePostgRESTConnectionURI({
                apiKey: "publishable-key",
                endpoint: "https://project.example/rest/v1",
                schema: "private_sync",
                useCustomRequestHandler: true,
                vaultCredential: "credential with spaces",
                vaultId: "vault-id-00000001",
            }),
            expectedRepositoryId: repositoryId,
            journalFormat: "adaptive-v1" as const,
            packReadPolicy: "whole-pack" as const,
        };

        const form = postgRESTJournalFormFromSettings(settings);

        expect(form).toEqual({
            apiKey: "publishable-key",
            endpoint: "https://project.example/rest/v1",
            expectedRepositoryId: repositoryId,
            schema: "private_sync",
            useCustomRequestHandler: true,
            vaultCredential: "credential with spaces",
            vaultId: "vault-id-00000001",
        });
        expect(postgRESTSyncSettingsFromForm(form)).toEqual(settings);
    });

    it("uses the exposed-schema default for a new profile", () => {
        expect(
            postgRESTJournalFormFromSettings({
                postgrestActiveConnectionURI: "",
                expectedRepositoryId: repositoryId,
                journalFormat: "opaque-v1",
                packReadPolicy: "range",
            })
        ).toEqual({
            apiKey: "",
            endpoint: "",
            expectedRepositoryId: "",
            schema: "livesync_api",
            useCustomRequestHandler: false,
            vaultCredential: "",
            vaultId: "",
        });
    });

    it("rejects an invalid pinned repository identity", () => {
        expect(() =>
            postgRESTSyncSettingsFromForm({
                apiKey: "publishable-key",
                endpoint: "https://project.example/rest/v1",
                expectedRepositoryId: "AA",
                schema: "livesync_api",
                useCustomRequestHandler: false,
                vaultCredential: "vault-credential",
                vaultId: "vault-id-00000001",
            })
        ).toThrow("expectedRepositoryId must be a canonical base64url-encoded 32-byte value");
    });
});
