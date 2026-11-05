import {
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { RemoteConnectionProbe } from "@vrtmrz/livesync-commonlib/replication";
import { resolveInitialPathIdentity } from "@/common/initialPathIdentity";

/** Adopt an existing central remote only for the first explicit Fetch. */
export async function resolveInitialFetchPathIdentity(
    settings: ObsidianLiveSyncSettings,
    createProbe: () => Promise<RemoteConnectionProbe | undefined>
): Promise<0 | 1 | undefined> {
    if (settings.isConfigured) return undefined;
    const hasRemote =
        (settings.remoteType === REMOTE_COUCHDB && !!settings.couchDB_URI && !!settings.couchDB_DBNAME) ||
        (settings.remoteType === REMOTE_MINIO && !!settings.endpoint && !!settings.bucket);
    if (!hasRemote) return undefined;
    return await resolveInitialPathIdentity(await createProbe(), settings.pathNormalizationVersion);
}
