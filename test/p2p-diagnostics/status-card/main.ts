import { mount } from "svelte";
import Card from "../../../src/features/P2PSync/P2PReplicator/P2PServerStatusCard.svelte";
import LogPane from "../../../src/modules/features/Log/LogPane.svelte";
import { eventHub } from "../../../src/common/events";
import { EVENT_SERVER_STATUS } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/TrysteroReplicatorP2PServer";
import { logMessages } from "@vrtmrz/livesync-commonlib/compat/mock_and_interop/stores";
import { setGlobalLogFunction } from "octagonal-wheels/common/logger";
import type { P2PDiagnosticEvent } from "@vrtmrz/livesync-commonlib/p2p";

setGlobalLogFunction(() => undefined);
const timestamp = 1_700_000_000_000;
const listeners = new Set<(event: P2PDiagnosticEvent) => void>();
const settings = { P2P_useDiagRTC: true, P2P_roomID: "fixture-room" };
const p2p = {
    transportLifecycle: { connect: async () => undefined, disconnect: async () => undefined },
    changeRelay: { enableBroadcastChanges() {}, disableBroadcastChanges() {} },
    diagnostics: {
        getDiagnosticSnapshot: () => ({
            relay: { category: "relay", code: "room-opened", reason: "relay-details-unobserved", timestamp },
            peer: { category: "peer", code: "peer-left", peerId: "departed-peer", timestamp },
        }),
        onDiagnosticEvent: (listener: (event: P2PDiagnosticEvent) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        requestStatus: () =>
            eventHub.emitEvent(EVENT_SERVER_STATUS, {
                isConnected: true,
                knownAdvertisements: [],
                serverPeerId: "fixture-self",
                roomId: "fixture-room",
                diag: {
                    totalNewConnections: 0,
                    totalSuccessfulConnections: 0,
                    totalFailedConnections: 0,
                    totalClosedConnections: 0,
                    details: {},
                },
            }),
    },
};
const core = {
    services: {
        setting: { currentSettings: () => settings },
        API: {
            showWindow: async (view: string) => {
                document.querySelector("#opened")!.textContent = view;
                logMessages.value = ["[P2P Diag] Earlier connection failure"];
                mount(LogPane, { target: document.querySelector("#logapp")!, props: { close() {} } });
            },
        },
    },
};
mount(Card, { target: document.querySelector("#app")!, props: { p2p: p2p as never, core: core as never } });
document.querySelector<HTMLButtonElement>("#complete")!.onclick = () => {
    for (const listener of listeners)
        listener({ category: "sync", code: "pull-completed", timestamp: timestamp + 1_000 });
};
