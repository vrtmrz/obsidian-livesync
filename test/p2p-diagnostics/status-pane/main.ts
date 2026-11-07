import { mount } from "svelte";
import Pane from "../../../src/features/P2PSync/P2PReplicator/P2PServerStatusPane.svelte";
import { eventHub } from "../../../src/common/events";
import {
    EVENT_SERVER_STATUS,
    EVENT_P2P_REPLICATOR_STATUS,
} from "@vrtmrz/livesync-commonlib/compat/replication/trystero/TrysteroReplicatorP2PServer";
import { setGlobalLogFunction } from "octagonal-wheels/common/logger";

setGlobalLogFunction(() => undefined);
const settings = { P2P_useDiagRTC: true, P2P_roomID: "fixture-room", remoteConfigurations: {} };
const knownAdvertisements = [
    { peerId: "permanent-peer", name: "Phone", platform: "mobile", isAccepted: true },
    {
        peerId: "session-peer",
        name: "LongDeviceNameWithoutWordBreaks".repeat(4),
        platform: "desktop",
        isTemporaryAccepted: true,
    },
    { peerId: "new-peer", name: "New device", platform: "mobile" },
    { peerId: "denied-peer", name: "Denied device", platform: "mobile", isTemporaryAccepted: false },
];
if (new URLSearchParams(location.search).has("preview")) {
    knownAdvertisements.splice(1, 1);
    knownAdvertisements.splice(2, 1);
    knownAdvertisements[0].name = "Android phone";
    knownAdvertisements[1].name = "MacBook Pro (Living room)";
}
const record = (action: unknown) => {
    document.querySelector("#action")!.textContent = JSON.stringify(action);
};
const p2p = {
    transportLifecycle: { connect: async () => undefined, disconnect: async () => undefined },
    changeRelay: { enableBroadcastChanges() {}, disableBroadcastChanges() {} },
    peerAdmission: {
        makeDecision: async (decision: unknown) => record(decision),
        revokeDecision: async (decision: unknown) => record(decision),
    },
    targetedTransfer: { synchroniseWithPeer: async (peerId: string) => record({ sync: peerId }) },
    diagnostics: {
        getDiagnosticSnapshot: () => ({ peer: { category: "peer", code: "peer-left", timestamp: 1_700_000_000_000 } }),
        onDiagnosticEvent: () => () => undefined,
        requestStatus: () => {
            eventHub.emitEvent(EVENT_SERVER_STATUS, {
                isConnected: true,
                knownAdvertisements,
                serverPeerId: "fixture-self",
                roomId: "fixture-room",
                diag: {
                    totalNewConnections: 4,
                    totalSuccessfulConnections: 2,
                    totalFailedConnections: 1,
                    totalClosedConnections: 1,
                    details: {},
                },
            } as never);
            eventHub.emitEvent(EVENT_P2P_REPLICATOR_STATUS, {
                replicatingFrom: [],
                replicatingTo: [],
                watchingPeers: [],
                isBroadcasting: false,
            } as never);
        },
    },
};
const core = { services: { setting: { currentSettings: () => settings }, API: { showWindow: async () => undefined } } };
mount(Pane, { target: document.querySelector("#app")!, props: { p2p: p2p as never, core: core as never } });
