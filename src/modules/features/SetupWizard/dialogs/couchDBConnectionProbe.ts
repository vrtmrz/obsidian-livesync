import type { RemoteConnectionProbe, RemoteConnectionProbeResult } from "@vrtmrz/livesync-commonlib/replication";
import { withOwnedRemoteResource } from "@/common/ownedRemoteResource";

/** Run the selected CouchDB setup mode within one owned probe lifetime. */
export async function probeCouchDBConnection(
    probe: RemoteConnectionProbe,
    createIfMissing: boolean
): Promise<RemoteConnectionProbeResult> {
    return await withOwnedRemoteResource(probe, (ownedProbe) =>
        ownedProbe.check({ createIfMissing, showResult: false })
    );
}

export function isValidCouchDBServerURL(value: string): boolean {
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
    } catch {
        return false;
    }
}
