import type { P2PSyncSetting } from "../../../lib/src/common/types";

export const EVENT_P2P_PEER_SHOW_EXTRA_MENU = "p2p-peer-show-extra-menu";

export enum AcceptedStatus {
    UNKNOWN = "Unknown",
    ACCEPTED = "Accepted",
    DENIED = "Denied",
    ACCEPTED_IN_SESSION = "Accepted in session",
    DENIED_IN_SESSION = "Denied in session",
}

export type PeerExtraMenuEvent = {
    peer: PeerStatus;
    event: MouseEvent;
};

export enum ConnectionStatus {
    CONNECTED = "Connected",
    CONNECTED_LIVE = "Connected(live)",
    DISCONNECTED = "Disconnected",
}
export type PeerStatus = {
    name: string;
    peerId: string;
    syncOnConnect: boolean;
    watchOnConnect: boolean;
    syncOnReplicationCommand: boolean;
    accepted: AcceptedStatus;
    status: ConnectionStatus;
    isFetching: boolean;
    isSending: boolean;
    isWatching: boolean;
};

declare global {
    interface LSEvents {
        [EVENT_P2P_PEER_SHOW_EXTRA_MENU]: PeerExtraMenuEvent;
        // [EVENT_P2P_REPLICATOR_PROGRESS]: P2PReplicationReport;
    }
}

export interface PluginShim {
    saveSettings: () => Promise<void>;
    settings: P2PSyncSetting;
    rebuilder: any;
    $$scheduleAppReload: () => void;
    $$getVaultName: () => string;
    // confirm: any;
}
export interface CommandShim {
    getConfig(key: string): string | null;
    setConfig(key: string, value: string): void;
    open(): Promise<void>;
    close(): Promise<void>;
    enableBroadcastCastings(): void; // cmdSync._replicatorInstance?.enableBroadcastChanges();
    disableBroadcastCastings(): void; ///cmdSync._replicatorInstance?.disableBroadcastChanges();
}
