# Architectural Decision Record: P2P Transport Compatibility Controls

## Status

Accepted — the user-facing controls will be introduced in stages. This record defines their boundaries before Commonlib settings and LiveSync interfaces are changed.

## Context

WebRTC connectivity depends on both devices, their browsers or embedded WebViews, NAT behaviour, carrier networks, VPNs, firewalls, and the path between them. A configuration which works on desktop Wi-Fi may fail on a mobile carrier, and moving the same devices through a mesh VPN may change the result without changing LiveSync.

The current P2P transport has several relevant properties:

- Trystero supplies the Nostr signalling strategy and the browser-owned WebRTC connection.
- Commonlib limits one RPC wire payload to 15,360 bytes so it remains below Trystero's own action-chunk boundary.
- Trystero supplies ordinary STUN servers and accepts an optional TURN server list with one username and credential.
- ICE chooses a direct, server-reflexive, or TURN-relayed path automatically.
- Commonlib can collect raw WebRTC statistics, but LiveSync does not yet present the selected candidate route in a concise diagnostic result.

Issue reports suggest that reducing the application payload may improve some mobile and constrained-network paths. A VPN such as Tailscale may also turn an unreliable route into a reliable one. These observations are consistent with NAT, path-MTU, fragmentation, or intermediary behaviour, but they do not prove one universal cause. Browser WebRTC implementations retain responsibility for SCTP, DTLS, ICE, packetisation, congestion control, and retransmission.

One low-level number cannot represent all of these concerns. Users need a small set of meaningful compatibility choices, while transport-internal controls which cannot be selected safely should remain implementation details.

## Decision

### Message-size presets

LiveSync will expose a `P2P message size` choice with four presets:

| Label                   | Maximum RPC wire payload | Intended use                                                                    |
| ----------------------- | -----------------------: | ------------------------------------------------------------------------------- |
| `Standard`              |             15,360 bytes | Existing default and best throughput.                                           |
| `Reduced`               |              2,048 bytes | First compatibility step for an unreliable path.                                |
| `Conservative`          |              1,024 bytes | Stronger compatibility at greater framing and processing cost.                  |
| `Maximum compatibility` |                800 bytes | Most conservative offered value for paths suspected of dropping larger packets. |

This value limits Commonlib RPC wire payloads before Trystero applies its own framing. It is not a LiveSync file Chunk size, an IP MTU, an SCTP fragment size, or a guarantee that lower layers will avoid fragmentation. The smaller presets reduce the amount presented to the transport at once and trade throughput for compatibility.

The bound applies to outgoing messages. A device which only lowers its own value still receives messages produced under the sender's value. The selected preset therefore belongs to the P2P profile and is included in an encrypted Setup URI for additional devices. A device which was configured earlier must be changed separately; the interface and troubleshooting guidance must state that the same conservative preset should be selected on every participating device. An absent key preserves the current 15,360-byte default.

Automatic negotiation or fallback between presets is deferred. A failed ordered data channel may require connection replacement before a smaller retry can prove anything, and changing transport parameters during a replication session would broaden the lifecycle contract considerably. The first implementation remains explicit, stable for one room lifetime, and inspectable.

### Connection path

LiveSync will expose a separate `Connection path` choice:

- `Automatic` retains normal ICE selection and is the default.
- `TURN relay only` supplies `iceTransportPolicy: 'relay'` and prevents direct or server-reflexive candidates from being selected.

`TURN relay only` is enabled only when at least one syntactically valid `turn:` or `turns:` URL is configured. If the last valid TURN URL is removed while relay-only mode is selected, saving the settings restores `Automatic` and displays a concise explanation.

The route policy is stored per P2P profile on the current device and is omitted from Setup URIs. It is a diagnostic and compatibility choice for the current device and network; forcing every synchronising device through TURN merely because one mobile path needs it would add avoidable latency, bandwidth cost, and metadata exposure.

No `Direct only` choice will be added. `Automatic` already prefers viable non-relayed candidates, and preventing TURN fallback would mainly create another failure mode.

### TURN server presentation

The first settings revision retains the existing storage contract of one credential shared by a list of TURN URLs. The dialogue will present it as a profile rather than as one comma-separated text field:

- an ordered list of `turn:` and `turns:` URL rows;
- one username;
- one credential; and
- the connection-path choice below the profile.

The interface may parse and serialise the existing comma-separated value so older profiles and Setup URIs remain compatible. A structured list of multiple credential profiles is deferred until a provider or self-hosted use case requires different credentials in the same P2P profile.

Static long-term credentials are the supported first stage. Managed providers may return short-lived credentials, but LiveSync must not store a provider API token or a Coturn shared authentication secret. A future managed-credential design needs a separately trusted HTTPS endpoint, expiry handling, refresh behaviour, failure reporting, and a clear Setup URI policy. It is not represented as another static password field.

### TURN allocation check and route diagnostics

A future `Test TURN server` action should create a disposable WebRTC check with `iceTransportPolicy: 'relay'`, request candidate gathering, and require at least one relay candidate. It must not read a Vault, join a LiveSync P2P room, or claim that document synchronisation has succeeded.

Where the browser exposes the evidence, the result should report:

- whether a relay candidate was gathered;
- the TURN URL used for that candidate;
- UDP, TCP, or TLS transport; and
- a bounded failure or inconclusive result.

Ordinary P2P diagnostics should later summarise the selected candidate pair as direct, server-reflexive, or relayed, with its transport. Raw `getStats()` output remains supporting evidence rather than the primary interface.

### Placement and defaults

These controls belong inside `P2P Configuration` under a `Connection compatibility` section. They do not require the repository-wide Advanced, Power User, or Edge Case modes. P2P itself remains a supported opt-in feature.

Existing profiles retain the following defaults:

- `P2P message size`: `Standard`;
- `Connection path`: `Automatic`; and
- TURN credentials and URLs: unchanged.

Settings which replace a room continue to use the established P2P room and transport lifecycle. No new reconnect interval, handshake timeout, keepalive interval, trickle-ICE, candidate-pool, data-channel reliability, or backpressure setting is exposed.

## Self-hosted TURN example

The repository supplies an optional Coturn Compose example under `docker/coturn/`. It uses a versioned upstream `coturn/coturn` image rather than maintaining another LiveSync Dockerfile.

The example deliberately covers one small static-credential deployment:

- Linux host networking, which avoids Docker's large port-range forwarding cost;
- TURN over UDP and TCP on port 3478;
- a bounded UDP relay port range;
- explicit long-term credentials;
- an explicit public IPv4 address;
- no TLS or DTLS in the starter configuration; and
- restrictions which prevent relaying to common private IPv4 ranges.

The starter does not recommend `turns:` on port 443. It conflicts with an HTTPS entry point which already owns the same IP address and TCP port, including the bundled CouchDB Caddy profile. When a restrictive network requires this path, the preferred deployment uses a separate TURN host or public IP address.

An outbound tunnel used for CouchDB may leave the host's public port 443 available when TURN uses a separate DNS record which resolves directly to that host, but the tunnel itself cannot carry TURN traffic. A layer-4 TLS router can also own the shared port and select separate CouchDB and TURN backends by SNI. That alternative adds certificate and routing responsibilities, depends on the intended TURN clients supplying usable SNI, and is outside the supplied Compose example. The standard Caddy image used by the CouchDB profile does not provide that layer-4 routing.

TURN over TLS is not HTTP and must reach Coturn directly or through a compatible layer-4 proxy. Supporting it also adds private-key, renewal, privileged-port, and real-network verification responsibilities.

The Compose example is not a hosted service supplied by the project, an availability guarantee, or a substitute for firewall and abuse controls. Operators remain responsible for DNS, certificates when enabled, port forwarding, bandwidth, quotas, monitoring, software updates, credential rotation, and legal or provider constraints.

## Security and privacy

TURN relays the already encrypted WebRTC connection. A TURN operator cannot read LiveSync's end-to-end encrypted Vault contents, but can observe endpoint addresses, timing, traffic volume, and service credentials.

Static credentials allow use of the operator's bandwidth until they are changed. They should be unique, high entropy, and limited to the intended deployment. Setup URIs are encrypted but still contain the P2P connection profile; they and their separate passphrases must be protected.

The Coturn Docker example uses environment interpolation for its static credential. A local Docker administrator can inspect the resulting container arguments and already has equivalent control of that host. The `.env` file remains untracked and should be readable only by the operator.

## Alternatives rejected

### Expose a free-form byte field

Most users cannot infer a safe application payload from a network MTU, and an arbitrary value makes reports difficult to compare. Four named presets provide a bounded troubleshooting ladder.

### Apply the smaller payload only on the affected mobile device

The bound controls outgoing messages. This would leave larger messages from another sender unchanged and could fail during the direction which matters most for an initial fetch.

### Force TURN whenever a TURN server is configured

TURN is normally a fallback. Forcing it by default adds latency and bandwidth cost, and exposes more connection metadata even when a direct path works.

### Automatically decrease the payload after a transfer failure

A transfer failure does not identify message size as the cause. Reusing a possibly wedged ordered channel would also make the retry inconclusive, while rebuilding the connection expands the lifecycle and user-notification design.

### Add browser-specific defaults

Safari, mobile Safari, Chrome, and Chrome on Android use different platform WebRTC implementations and lifecycle policies, but the failing route also depends on both networks and the remote peer. There is not enough stable evidence for a browser-name heuristic. Explicit cross-platform presets are more predictable.

### Build and maintain a LiveSync Coturn image

The upstream project already publishes a multi-platform image and documents its configuration contract. A local Dockerfile would duplicate security updates and release work without adding a LiveSync-specific server component.

### Bundle a shared port-443 router

A layer-4 TLS router could share one public address between distinct CouchDB and TURN hostnames by inspecting SNI. Bundling that topology would replace the current Caddy ownership of port 443, add another certificate and routing lifecycle, and rely on the intended TURN clients presenting usable SNI. A separate TURN host or public IP address keeps those failure and ownership boundaries explicit.

## Verification

The implementation stage must add focused tests before production changes:

- settings-schema defaults for absent keys;
- Setup URI round trips which retain the message-size preset but omit the device-local connection path;
- compatibility parsing and serialisation of the existing TURN URL string;
- mapping each message-size preset to the exact Commonlib wire bound;
- mapping relay-only mode to `iceTransportPolicy: 'relay'`;
- rejection or automatic reset of relay-only mode without a valid TURN URL;
- room replacement after either effective transport setting changes;
- a disposable TURN allocation check using injected WebRTC boundaries; and
- a real transport test only for the device- or network-owned behaviour which deterministic injection cannot prove.

The Coturn example is checked independently with `docker compose config`. Runtime verification uses a real Coturn allocation from outside the server network and confirms both UDP and TCP client paths before it is presented as a known-working deployment.

## Consequences

- Users gain a small compatibility ladder without learning WebRTC internals.
- A conservative message size affects throughput wherever it is selected or imported, and must be applied to every participating device to protect all transfer directions.
- TURN can be forced for diagnosis or hostile networks without making relay use the global default.
- Static and managed TURN credentials have separate, explicit responsibility boundaries.
- Browser-specific heuristics, automatic payload fallback, and low-level transport knobs remain out of scope.
- A reproducible self-hosted starter is available without making LiveSync responsible for a separate TURN image.
