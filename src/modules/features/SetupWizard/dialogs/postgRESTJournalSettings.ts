import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    REMOTE_POSTGREST,
    journalProtocolConfigurationForSettings,
    parsePostgRESTConnectionURI,
    serialisePostgRESTConnectionURI,
    type PostgRESTConnection,
    type PostgRESTSyncSetting,
} from "@vrtmrz/livesync-commonlib/journal-storage";

export type PostgRESTJournalForm = PostgRESTConnection & {
    expectedRepositoryId: string;
};

const emptyPostgRESTConnection: PostgRESTConnection = {
    apiKey: "",
    endpoint: "",
    schema: "livesync_api",
    useCustomRequestHandler: false,
    vaultCredential: "",
    vaultId: "",
};

function resolveProtocol(settings: PostgRESTSyncSetting) {
    return journalProtocolConfigurationForSettings({
        ...DEFAULT_SETTINGS,
        remoteType: REMOTE_POSTGREST,
        ...settings,
        journalFormat: "adaptive-v1",
        packReadPolicy: "whole-pack",
    });
}

export function postgRESTJournalFormFromSettings(settings: PostgRESTSyncSetting): PostgRESTJournalForm {
    const activeConnectionURI = settings.postgrestActiveConnectionURI.trim();
    const connection = activeConnectionURI
        ? parsePostgRESTConnectionURI(activeConnectionURI)
        : emptyPostgRESTConnection;
    const protocol = resolveProtocol({
        ...settings,
        expectedRepositoryId: activeConnectionURI ? settings.expectedRepositoryId : "",
    });
    return {
        ...connection,
        expectedRepositoryId: protocol.expectedRepositoryId,
    };
}

export function postgRESTSyncSettingsFromForm(form: PostgRESTJournalForm): PostgRESTSyncSetting {
    const settings: PostgRESTSyncSetting = {
        postgrestActiveConnectionURI: serialisePostgRESTConnectionURI({
            apiKey: form.apiKey.trim(),
            endpoint: form.endpoint.trim(),
            schema: form.schema.trim(),
            useCustomRequestHandler: form.useCustomRequestHandler,
            vaultCredential: form.vaultCredential,
            vaultId: form.vaultId.trim(),
        }),
        expectedRepositoryId: form.expectedRepositoryId.trim(),
        journalFormat: "adaptive-v1",
        packReadPolicy: "whole-pack",
    };
    resolveProtocol(settings);
    return settings;
}
