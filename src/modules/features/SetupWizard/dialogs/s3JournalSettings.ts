import { DEFAULT_SETTINGS, REMOTE_MINIO, type BucketSyncSetting } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { journalProtocolConfigurationForSettings } from "@vrtmrz/livesync-commonlib/journal-storage";

export function normaliseS3JournalSettings(settings: BucketSyncSetting): BucketSyncSetting {
    const journalFormat = settings.journalFormat ?? "opaque-v1";
    const candidate: BucketSyncSetting = {
        ...settings,
        bucket: settings.bucket.trim(),
        bucketPrefix: settings.bucketPrefix.trim(),
        endpoint: settings.endpoint.trim(),
        expectedRepositoryId: journalFormat === "adaptive-v1" ? (settings.expectedRepositoryId ?? "").trim() : "",
        journalFormat,
        packReadPolicy: journalFormat === "adaptive-v1" ? (settings.packReadPolicy ?? "whole-pack") : "whole-pack",
        region: settings.region.trim(),
    };
    const protocol = journalProtocolConfigurationForSettings({
        ...DEFAULT_SETTINGS,
        ...candidate,
        remoteType: REMOTE_MINIO,
    });
    return {
        ...candidate,
        ...protocol,
    };
}
