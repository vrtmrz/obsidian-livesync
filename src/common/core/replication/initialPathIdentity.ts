import type { RemoteConnectionProbe } from "@vrtmrz/livesync-commonlib/replication";
import { withOwnedRemoteResource } from "./ownedRemoteResource";

/** Select initial settings from a read-only declaration before opening the local database. */
export async function resolveInitialPathIdentity(
    probe: RemoteConnectionProbe | undefined,
    newEnvironmentVersion: number
): Promise<0 | 1> {
    if (!probe) throw new Error("The remote path identity cannot be inspected.");
    return await withOwnedRemoteResource(probe, async (ownedProbe) => {
        if (!ownedProbe.inspectPathIdentity) throw new Error("The remote path identity cannot be inspected.");
        const result = await ownedProbe.inspectPathIdentity();
        return result.status === "empty" ? (newEnvironmentVersion === 1 ? 1 : 0) : result.pathNormalizationVersion;
    });
}
