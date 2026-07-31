import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type BucketSyncSetting } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { pickBucketSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { normaliseS3JournalSettings } from "./s3JournalSettings";

function settings(overrides: Partial<BucketSyncSetting> = {}): BucketSyncSetting {
    return {
        ...pickBucketSyncSettings(DEFAULT_SETTINGS),
        ...overrides,
    };
}

describe("normaliseS3JournalSettings", () => {
    it("retains and validates Adaptive repository options", () => {
        const repositoryId = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

        const result = normaliseS3JournalSettings(
            settings({
                bucket: " vault ",
                bucketPrefix: " journals/ ",
                endpoint: " https://storage.example ",
                expectedRepositoryId: ` ${repositoryId} `,
                journalFormat: "adaptive-v1",
                packReadPolicy: "range",
                region: " auto ",
            })
        );

        expect(result).toMatchObject({
            bucket: "vault",
            bucketPrefix: "journals/",
            endpoint: "https://storage.example",
            expectedRepositoryId: repositoryId,
            journalFormat: "adaptive-v1",
            packReadPolicy: "range",
            region: "auto",
        });
    });

    it("uses conservative Opaque defaults for older profiles", () => {
        const legacy = settings();
        delete legacy.expectedRepositoryId;
        delete legacy.journalFormat;
        delete legacy.packReadPolicy;

        expect(normaliseS3JournalSettings(legacy)).toMatchObject({
            expectedRepositoryId: "",
            journalFormat: "opaque-v1",
            packReadPolicy: "whole-pack",
        });
    });

    it("clears Adaptive-only options when Opaque Journal is selected", () => {
        expect(
            normaliseS3JournalSettings(
                settings({
                    expectedRepositoryId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                    journalFormat: "opaque-v1",
                    packReadPolicy: "range",
                })
            )
        ).toMatchObject({
            expectedRepositoryId: "",
            journalFormat: "opaque-v1",
            packReadPolicy: "whole-pack",
        });
    });

    it("rejects a non-canonical expected repository ID", () => {
        expect(() =>
            normaliseS3JournalSettings(
                settings({
                    expectedRepositoryId: "not-a-repository-id",
                    journalFormat: "adaptive-v1",
                })
            )
        ).toThrow("expectedRepositoryId must be a canonical base64url-encoded 32-byte value");
    });
});
