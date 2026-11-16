import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import {
    REMOTE_P2P,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

/** Returns whether the selected main remote represents the P2P-only setup. */
export function isP2PMainRemote(settings: ObsidianLiveSyncSettings): boolean {
    if (settings.remoteType === REMOTE_P2P) return true;

    const activeId = settings.activeConfigurationId?.trim();
    const activeConfiguration = activeId ? settings.remoteConfigurations?.[activeId] : undefined;
    if (!activeConfiguration) return false;

    try {
        return ConnectionStringParser.parse(activeConfiguration.uri).type === "p2p";
    } catch {
        return false;
    }
}
