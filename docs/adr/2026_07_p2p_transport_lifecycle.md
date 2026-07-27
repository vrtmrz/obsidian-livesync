# Architectural Decision Record: P2P Room and Transport Lifecycle

## Status

Accepted — implemented and verified through Commonlib owner tests, the Compose transport suite, and the real-Obsidian setup workflow.

## Context

Self-hosted LiveSync uses Trystero's Nostr strategy for P2P discovery, signalling, and WebRTC transport. Three related resources have different owners and lifetimes:

- a LiveSync P2P service instance owns its commands, RPC sessions, advertisements, and room membership;
- Trystero owns the underlying WebRTC peers and may share one physical peer across more than one room; and
- Trystero's Nostr relay manager owns WebSocket clients shared by relay URL.

Closing every `RTCPeerConnection` returned by `room.getPeers()` bypasses Trystero's shared-peer manager. The manager may then retain a stale shared peer and prevent a replacement LiveSync replicator from discovering the same remote peer again.

Room departure and physical transport destruction are not equivalent. `room.leave()` sends the room-leave action, removes that room's actions and callbacks, and detaches its shared-peer binding. Trystero may retain a healthy physical WebRTC peer for later reuse after the last room binding has gone. The retained peer cannot carry actions for the room which has been left.

Relay WebSockets have a separate lifecycle. LiveSync's explicit disconnect operation must close them and prevent automatic reconnection. A later explicit connect must allow reconnection before joining the room again.

## Decision

Normal P2P shutdown delegates physical peer ownership to Trystero:

1. Stop LiveSync broadcast, replication, watch, client, and RPC state.
2. Leave the active Trystero room through `room.leave()`.
3. Remove LiveSync's room, advertisement, diagnostic-listener, and active-instance references.
4. Pause Trystero relay reconnection and close the current relay WebSockets.

LiveSync does not call `close()` on the `RTCPeerConnection` values returned by `room.getPeers()` during normal shutdown or from a peer-leave callback. A peer-leave callback removes LiveSync-owned advertisement and client state only. Trystero remains responsible for deciding whether an underlying shared peer is reusable, stale, or ready for idle destruction.

The explicit disconnect operation therefore has the following contract:

| Resource                          | State after the operation                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| LiveSync P2P service and RPC room | Closed immediately.                                                                               |
| Trystero room membership          | Left; room actions and advertisements are no longer available.                                    |
| Nostr relay WebSockets            | Closed, with automatic reconnection paused.                                                       |
| Underlying WebRTC peer            | May remain idle under Trystero ownership for reuse, but cannot carry the departed room's traffic. |

This operation is a logical LiveSync disconnection and a physical signalling-server disconnection. It does not promise that every browser-owned WebRTC object has been destroyed synchronously.

An explicit connect resumes relay reconnection before opening a new room. Settings application and database lifecycle replacement close the current LiveSync replicator, discard it, construct a new instance from the current settings, and open that current instance when the configured policy requires it. Commands, event handlers, and panes resolve the current service-feature result at the point of use rather than retaining an obsolete replicator.

Lifecycle operations on one `LiveSyncTrysteroReplicator` are serialised. A close requested while an open is in progress must leave no orphan room serving, and repeated opens must not create parallel rooms. No fixed delay is inserted between close and open: readiness is determined by the actual lifecycle operation and peer discovery.

Relay sockets retain their Trystero-provided close handlers. LiveSync pauses relay reconnection, closes the sockets, and later resumes reconnection through Trystero's public functions. It does not replace `socket.onclose`, because Trystero uses that handler to retire and recreate shared relay clients correctly.

P2P setup follows the transport's actual ownership model. Initialising the first device resets and scans the local database, but does not attempt to lock, reset, or upload to a non-existent central remote database. Its confirmation dialogues therefore describe preparing this device and do not present warnings about overwriting a central server or an option to fetch its configuration. An additional device selects a peer once, performs Fetch once, then resumes database and Vault reflection. The generic second convergence pass remains reserved for central remote types because repeating it for P2P would ask the user to select the same peer twice.

## Ownership

Commonlib owns the LiveSync-specific P2P service, RPC, command, and lifecycle composition. Trystero owns WebRTC peer creation, sharing, reuse, stale detection, and destruction, as well as relay-client reconstruction. The Self-hosted LiveSync host owns the current Commonlib service-feature result and supplies the platform services used by its current replicator.

Self-hosted LiveSync does not add a separate root Trystero dependency. Tests which must observe relay sockets resolve the exact Trystero generation owned by the locked Commonlib package, avoiding two independent transport singletons in one process.

## Alternatives rejected

### Close every value returned by `room.getPeers()`

This bypasses Trystero's shared-peer manager and can prevent a replacement replicator from rediscovering the same peer.

### Add a fixed close-to-open delay

A timing guess does not repair stale ownership and would make ordinary settings application slower.

### Keep raw close behaviour behind a force command

Changing the command name does not make the lifecycle safe. A force command which cannot reconnect predictably has no reliable operational value.

### Override relay `onclose` to suppress reconnection

This interferes with Trystero's shared relay clients. The public pause and resume functions provide the intended control boundary.

## Verification

Commonlib unit tests prove that normal P2P host closure calls `room.leave()` without directly closing Trystero-owned peer connections. Additional package tests cover the action API, replaceable peer-event subscriptions, multiple RPC transport disposers, serialised open and close operations, initialisation of the first device without a central remote, and Fetch running once for an additional device.

Self-hosted LiveSync unit tests prove that settings and database replacement leave panes on the current replicator, and that an explicit P2P rebuild bypasses the policy intended for ordinary replication.

The canonical Compose P2P suite uses a real local Nostr relay and WebRTC implementation. It covers ordinary two-peer synchronisation, replacement of the active LiveSync replicator followed by discovery and transfer with the same peer, and explicit relay disconnection followed by paused and resumed reconnection. The lifecycle scenario is exposed only through a Docker test build and an injected CLI command runner; it is not part of the public CLI command surface.

The real-Obsidian P2P Setup URI workflow creates the first device, generates the second-device URI from it, accepts each peer visibly, and verifies a two-way note round-trip through a local relay. A separate focused pane test covers the principal connection control and teardown without requiring a remote peer. Transport replacement and relay-socket lifecycle remain owned by the package and Compose tests rather than being duplicated in Obsidian.

## Consequences

- Replacing a P2P replicator no longer leaves host views or commands bound to an obsolete instance.
- Explicit signalling-server disconnection has a testable socket-level meaning without claiming immediate destruction of idle WebRTC objects.
- Settings which change the relay, room, passphrase, or TURN configuration can replace the whole LiveSync room safely.
- Trystero may reuse healthy peers across room lifecycles, reducing unnecessary renegotiation.
- Strict physical WebRTC teardown remains unavailable until Trystero exposes a safe ownership-aware operation.
