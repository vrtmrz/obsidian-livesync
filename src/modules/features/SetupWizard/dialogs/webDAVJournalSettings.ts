import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    REMOTE_WEBDAV,
    journalProtocolConfigurationForSettings,
    parseWebDAVConnectionURI,
    serialiseWebDAVConnectionURI,
    type AdaptiveJournalPackReadPolicyV1,
    type JournalFormatV1,
    type JournalStorageAdaptiveCapabilityInspection,
    type JournalStorageCapabilityInspection,
    type WebDAVConnection,
    type WebDAVSyncSetting,
} from "@vrtmrz/livesync-commonlib/journal-storage";

export type WebDAVJournalForm = WebDAVConnection & {
    expectedRepositoryId: string;
    journalFormat: JournalFormatV1;
    packReadPolicy: AdaptiveJournalPackReadPolicyV1;
};

export type WebDAVCapabilitySummary =
    | { kind: "verified" }
    | { kind: "not-checked" }
    | { kind: "unsupported"; missing: string[] }
    | {
          kind: "failed";
          category: "authentication" | "invalid-response" | "permission" | "rate-limited" | "unavailable" | "unknown";
          retry: "later" | "never" | "verify-first";
      };

export type WebDAVAdaptiveCapabilitySummary = {
    byteRange: WebDAVCapabilitySummary;
    required: WebDAVCapabilitySummary;
};

const emptyWebDAVConnection: WebDAVConnection = {
    customHeaders: "",
    endpoint: "",
    password: "",
    prefix: "",
    useCustomRequestHandler: false,
    username: "",
};

function resolveProtocol(settings: WebDAVSyncSetting) {
    return journalProtocolConfigurationForSettings({
        ...DEFAULT_SETTINGS,
        remoteType: REMOTE_WEBDAV,
        ...settings,
    });
}

export function webDAVJournalFormFromSettings(settings: WebDAVSyncSetting): WebDAVJournalForm {
    const connection = settings.webDAVactiveConnectionURI.trim()
        ? parseWebDAVConnectionURI(settings.webDAVactiveConnectionURI.trim())
        : emptyWebDAVConnection;
    const protocol = resolveProtocol(settings);
    return {
        ...connection,
        ...protocol,
    };
}

export function webDAVSyncSettingsFromForm(form: WebDAVJournalForm): WebDAVSyncSetting {
    const journalFormat = form.journalFormat;
    const settings: WebDAVSyncSetting = {
        webDAVactiveConnectionURI: serialiseWebDAVConnectionURI({
            customHeaders: form.customHeaders.trim(),
            endpoint: form.endpoint.trim(),
            password: form.password,
            prefix: form.prefix.trim(),
            useCustomRequestHandler: form.useCustomRequestHandler,
            username: form.username.trim(),
        }),
        expectedRepositoryId: journalFormat === "adaptive-v1" ? form.expectedRepositoryId.trim() : "",
        journalFormat,
        packReadPolicy: journalFormat === "adaptive-v1" ? form.packReadPolicy : "whole-pack",
    };
    resolveProtocol(settings);
    return settings;
}

function summariseCapabilityInspection(inspection: JournalStorageCapabilityInspection): WebDAVCapabilitySummary {
    switch (inspection.status) {
        case "verified":
            return { kind: "verified" };
        case "not-checked":
            return { kind: "not-checked" };
        case "unsupported":
            return { kind: "unsupported", missing: [...inspection.missing] };
        case "failed":
            return {
                category: inspection.failure.category,
                kind: "failed",
                retry: inspection.failure.retry,
            };
    }
}

export function summariseAdaptiveCapabilityInspection(
    inspection: JournalStorageAdaptiveCapabilityInspection
): WebDAVAdaptiveCapabilitySummary {
    return {
        byteRange: summariseCapabilityInspection(inspection.byteRange),
        required: summariseCapabilityInspection(inspection.required),
    };
}
