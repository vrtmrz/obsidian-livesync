// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { InjectableServiceHub } from "@lib/services/InjectableServices.ts";
export declare const EVENT_P2P_PEER_SHOW_EXTRA_MENU = "p2p-peer-show-extra-menu";
export declare enum AcceptedStatus {
    UNKNOWN = "Unknown",
    ACCEPTED = "Accepted",
    DENIED = "Denied",
    ACCEPTED_IN_SESSION = "Accepted in session",
    DENIED_IN_SESSION = "Denied in session"
}
export type PeerExtraMenuEvent = {
    peer: PeerStatus;
    event: MouseEvent;
};
export declare enum ConnectionStatus {
    CONNECTED = "Connected",
    CONNECTED_LIVE = "Connected(live)",
    DISCONNECTED = "Disconnected"
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
    }
}
export interface PluginShim {
    services: InjectableServiceHub;
    core: {
        services: InjectableServiceHub;
    };
}
