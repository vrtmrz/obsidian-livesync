import { describe, expect, it } from "vitest";

import { serialiseWebDAVConnectionURI } from "@vrtmrz/livesync-commonlib/journal-storage";
import {
    summariseAdaptiveCapabilityInspection,
    webDAVJournalFormFromSettings,
    webDAVSyncSettingsFromForm,
} from "./webDAVJournalSettings.ts";

const repositoryId = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("WebDAV Journal settings", () => {
    it("round-trips connection fields separately from Adaptive protocol fields", () => {
        const settings = {
            webDAVactiveConnectionURI: serialiseWebDAVConnectionURI({
                customHeaders: "X-Vault: notes",
                endpoint: "https://dav.example/remote.php/dav/files/alice",
                password: "p@ss word",
                prefix: "vault/notes/",
                useCustomRequestHandler: true,
                username: "alice@example.com",
            }),
            expectedRepositoryId: repositoryId,
            journalFormat: "adaptive-v1" as const,
            packReadPolicy: "range" as const,
        };

        const form = webDAVJournalFormFromSettings(settings);

        expect(form).toEqual({
            customHeaders: "X-Vault: notes",
            endpoint: "https://dav.example/remote.php/dav/files/alice",
            expectedRepositoryId: repositoryId,
            journalFormat: "adaptive-v1",
            packReadPolicy: "range",
            password: "p@ss word",
            prefix: "vault/notes/",
            useCustomRequestHandler: true,
            username: "alice@example.com",
        });
        expect(webDAVSyncSettingsFromForm(form)).toEqual(settings);
    });

    it("normalises editable text and removes Adaptive-only options from Opaque settings", () => {
        const settings = webDAVSyncSettingsFromForm({
            customHeaders: "  X-Vault: notes  ",
            endpoint: "  http://localhost:8080/dav  ",
            expectedRepositoryId: `  ${repositoryId}  `,
            journalFormat: "opaque-v1",
            packReadPolicy: "range",
            password: " password with spaces ",
            prefix: "  vault/notes/  ",
            useCustomRequestHandler: false,
            username: "  alice  ",
        });

        expect(settings).toEqual({
            webDAVactiveConnectionURI:
                "sls+webdav://alice:%20password%20with%20spaces%20@localhost:8080/dav?insecure=true&prefix=vault%2Fnotes%2F&headers=X-Vault%3A+notes",
            expectedRepositoryId: "",
            journalFormat: "opaque-v1",
            packReadPolicy: "whole-pack",
        });
    });

    it("rejects an invalid pinned repository identity", () => {
        expect(() =>
            webDAVSyncSettingsFromForm({
                customHeaders: "",
                endpoint: "https://dav.example/vault",
                expectedRepositoryId: "AA",
                journalFormat: "adaptive-v1",
                packReadPolicy: "whole-pack",
                password: "secret",
                prefix: "",
                useCustomRequestHandler: false,
                username: "alice",
            })
        ).toThrow("expectedRepositoryId must be a canonical base64url-encoded 32-byte value");
    });

    it("presents required capabilities and optional byte-range support independently", () => {
        expect(
            summariseAdaptiveCapabilityInspection({
                required: { status: "verified" },
                byteRange: { missing: ["byte-range"], status: "unsupported" },
            })
        ).toEqual({
            required: { kind: "verified" },
            byteRange: { kind: "unsupported", missing: ["byte-range"] },
        });

        expect(
            summariseAdaptiveCapabilityInspection({
                required: {
                    failure: { category: "authentication", retry: "never" },
                    status: "failed",
                },
                byteRange: { status: "not-checked" },
            })
        ).toEqual({
            required: { category: "authentication", kind: "failed", retry: "never" },
            byteRange: { kind: "not-checked" },
        });
    });
});
