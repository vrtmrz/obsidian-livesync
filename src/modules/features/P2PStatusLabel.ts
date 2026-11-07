import { reactiveSource, type ReactiveValue } from "octagonal-wheels/dataobject/reactive";
import type { P2PReplicationProgress } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/TrysteroReplicator";
import type { P2PDiagnostics } from "@vrtmrz/livesync-commonlib/p2p";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { FAST_FORWARD_COUNT_LINGER_MS } from "./ReplicationStatusLabel.ts";
import type { DisposableReactiveValue } from "./StatusBarDisplay.ts";
import type { StatusBarPart } from "./StatusBarRenderer.ts";

type PeerStatusProjection = { message: string; parts: StatusBarPart[] };
export type P2PStatusProjection = PeerStatusProjection & {
    peers: ReadonlyMap<string, PeerStatusProjection>;
};

export function selectReplicationStatus(
    primary: PeerStatusProjection,
    p2p: P2PStatusProjection,
    p2pIsPrimary: boolean
): { primary: PeerStatusProjection; auxiliary: PeerStatusProjection } {
    if (!p2pIsPrimary) return { primary, auxiliary: p2p };
    const parts: StatusBarPart[] = p2p.parts.length
        ? [{ key: "sync", text: "Sync: " }, ...p2p.parts]
        : [{ key: "sync", text: "Sync: 💤 P2P" }];
    return { primary: { message: partsMessage(parts), parts }, auxiliary: { message: "", parts: [] } };
}

const directions = ["sending", "fetching"] as const;
type Direction = (typeof directions)[number];

function directionParts(
    peer: P2PReplicationProgress,
    direction: Direction,
    checkedChanges: number | undefined
): StatusBarPart[] {
    const progress = peer[direction];
    const key = `p2p-${peer.peerId}-${direction}`;
    const arrow = direction === "sending" ? "↑" : "↓";
    const parts: StatusBarPart[] = progress.statistics
        ? [
              {
                  key,
                  text: ` ${arrow} `,
                  value: progress.statistics.documents,
                  title: direction === "sending" ? "Sent document revisions" : "Received document revisions",
              },
          ]
        : [
              {
                  key,
                  text: ` ${arrow} seq `,
                  value: progress.current,
                  suffix: progress.current === progress.max ? "" : ` (${progress.max})`,
              },
          ];
    if (checkedChanges !== undefined) {
        parts.push({
            key: `${key}-ff`,
            text: ` ⏩${arrow} `,
            value: checkedChanges,
            title: "Compared changes-feed entries",
        });
    }
    return parts;
}

function partsMessage(parts: readonly StatusBarPart[]): string {
    return parts.map((part) => part.text + (part.value === undefined ? "" : part.value + (part.suffix ?? ""))).join("");
}

/** Retains transfer counts while independently expiring each peer's directional comparison labels. */
export function createP2PProgressDisplay(
    source: ReactiveValue<readonly P2PReplicationProgress[]>,
    lingerMs = FAST_FORWARD_COUNT_LINGER_MS
): DisposableReactiveValue<P2PStatusProjection> {
    const displayed = reactiveSource<P2PStatusProjection>({ message: "", parts: [], peers: new Map() });
    const observed = new Map<string, number>();
    const visible = new Map<string, number>();
    const timers = new Map<string, number>();
    let disposed = false;

    const cancelTimer = (key: string) => {
        const timer = timers.get(key);
        if (timer !== undefined) compatGlobal.clearTimeout(timer);
        timers.delete(key);
    };
    const render = () => {
        const peers = new Map<string, PeerStatusProjection>();
        const parts: StatusBarPart[] = [];
        for (const peer of source.value) {
            const active = peer.fetching.isActive || peer.sending.isActive;
            const peerParts = directions.flatMap((direction) =>
                directionParts(peer, direction, visible.get(`${peer.peerId}:${direction}`))
            );
            const namedParts = [
                { key: `p2p-${peer.peerId}`, text: `${active ? "⚡" : "💤"} ${peer.peerName}` },
                ...peerParts,
            ];
            peers.set(peer.peerId, { message: partsMessage(peerParts).trim(), parts: peerParts });
            if (parts.length) parts.push({ key: `p2p-${peer.peerId}-separator`, text: " / " });
            parts.push(...namedParts);
        }
        displayed.value = { message: partsMessage(parts), parts, peers };
    };
    const update = () => {
        if (disposed) return;
        const present = new Set<string>();
        for (const peer of source.value) {
            for (const direction of directions) {
                const key = `${peer.peerId}:${direction}`;
                present.add(key);
                const count = peer[direction].statistics?.checkedChanges;
                if (count === observed.get(key)) continue;
                cancelTimer(key);
                visible.delete(key);
                if (count === undefined) observed.delete(key);
                else observed.set(key, count);
                if (count === undefined || !Number.isFinite(count) || count <= 0) continue;
                visible.set(key, count);
                timers.set(
                    key,
                    compatGlobal.setTimeout(
                        () => {
                            timers.delete(key);
                            if (disposed) return;
                            visible.delete(key);
                            render();
                        },
                        Math.max(0, lingerMs)
                    )
                );
            }
        }
        for (const key of observed.keys()) {
            if (present.has(key)) continue;
            cancelTimer(key);
            observed.delete(key);
            visible.delete(key);
        }
        render();
    };
    source.onChanged(update);
    update();
    return {
        get value() {
            return displayed.value;
        },
        onChanged: displayed.onChanged,
        offChanged: displayed.offChanged,
        dispose() {
            if (disposed) return;
            disposed = true;
            source.offChanged(update);
            for (const key of timers.keys()) cancelTimer(key);
        },
    };
}

/** Bridges diagnostics snapshots to the same display used by the editor and status bar. */
export function observeP2PDiagnosticsProgress(
    diagnostics: P2PDiagnostics,
    listener: (snapshot: P2PStatusProjection) => void
): () => void {
    const source = reactiveSource<readonly P2PReplicationProgress[]>(diagnostics.getReplicationProgress?.() ?? []);
    const display = createP2PProgressDisplay(source);
    const update = () => listener(display.value);
    display.onChanged(update);
    const unsubscribe = diagnostics.onReplicationProgress?.((snapshot) => {
        source.value = snapshot;
    });
    update();
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        unsubscribe?.();
        display.offChanged(update);
        display.dispose();
    };
}
