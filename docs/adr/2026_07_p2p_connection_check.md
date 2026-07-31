# Architectural Decision Record: Browser-assisted P2P Connection Check

## Status

Accepted — WebPeer provides a disposable, browser-observed connection check with a clean one-device path and an optional same-room second-device attempt.

## Context

P2P availability depends on the browser, device, signalling relay, NAT, firewall, and current network. A Setup URI can make a trial easier, but a connection observed between a browser and one device does not prove that two other devices can connect to each other, and a WebRTC connection does not prove that LiveSync documents can be synchronised correctly.

Showing this experiment inside the ordinary LiveSync interface would mix a temporary connectivity check with the state of a real Vault. It would also make a browser-owned diagnostic result appear to be a plug-in-owned synchronisation result.

The Commonlib diagnostic counters are cumulative within one JavaScript realm. A negotiation may create more than one `RTCPeerConnection`, a failed attempt may later be followed by a successful retry, and closing a successful connection is not a failure. The counters therefore cannot be interpreted as peer counts or as mutually exclusive outcomes.

## Decision

WebPeer provides a separate page labelled 'P2P connection check'. It acts as a temporary reference peer and creates a fresh, random P2P configuration locally in the browser. The page displays an encrypted Setup URI, a QR code containing that URI, and the separate Setup URI passphrase.

The initial implementation is part of the WebPeer production build and is served over HTTPS or from `localhost`. A downloaded copy of `check.html` alone is not a supported standalone application because the build uses separate module assets and origin-scoped browser storage.

Each check has these boundaries:

| Participant                | Responsibility                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| Browser page               | Joins the generated room as the diagnostic reference peer and displays its own diagnostic counters. |
| Desktop or mobile LiveSync | Opens the generated Setup URI in a dedicated empty Vault and attempts the ordinary P2P connection.  |
| User                       | Uses an empty Vault for every device and chooses either a fresh room or the explicitly less isolated same-room second-device attempt. |

The generated device configuration:

- uses a dedicated P2P application identifier so that test rooms do not overlap ordinary LiveSync rooms;
- uses random room, P2P, Vault-encryption, and Setup URI secrets;
- enables P2P auto-start so that a dedicated empty test Vault attempts the connection after setup;
- does not enable automatic broadcasting, peer acceptance, watching, or replication;
- omits device-local names from the Setup URI; and
- enables diagnostic WebRTC wrapping only on the browser reference peer.

The browser joins the room only after the user explicitly starts monitoring. Preparing the Setup URI and QR code does not contact the signalling relay. The page must remain open while monitoring.

The primary path checks one target device. The user selects either desktop or mobile before generating the configuration. Starting a fresh check reloads the page, creates a new room, and resets the page-scoped diagnostic baseline; this remains the clearest way to compare devices.

After the first connection succeeds, the page can scroll back to the existing QR code without generating new credentials. It also offers an optional same-room second-device attempt. This keeps the browser and first device connected, records the current diagnostic totals and active `RTCPeerConnection` identifiers as a local baseline, and reuses the exact Setup URI for another empty Vault. It reports an additional connection only when both the successful-connection total and the number of simultaneous active connections increase, with an active connection identifier absent from the baseline. A reconnect which replaces the first connection can therefore increase negotiation counters without satisfying the additional-connection result.

The same-room result remains a convenience rather than an isolated comparison. Its totals are still cumulative, a connection is not a device identity, it depends on the first device remaining connected, and unusual reconnect timing can be harder to interpret than a fresh room. The interface keeps the fresh-check action available and explains this limitation beside the additional result.

The page displays the following Commonlib diagnostic totals:

- new connection states;
- successful connection states;
- failed connection states; and
- closed connection states.

A successful total greater than zero proves that this browser and the target device established at least one WebRTC connection in the generated room. That successful result remains valid if a later closed or failed total increases. A failed total without a successful total describes a failed attempt, not a final verdict, because the transport may retry. If no success has been observed after the documented observation period, the result is inconclusive for P2P on the current network. The page recommends CouchDB for predictable synchronisation when repeated checks on the intended networks do not connect.

The page does not claim to verify document transfer, conflict handling, sustained connectivity, background execution, or a direct desktop-to-mobile path. An optional final test can use two disposable empty Vaults and a note round trip directly between the user's devices. That direct test is more representative, but its result cannot be observed reliably by the browser page without a separate reporting protocol.

## Security and privacy

All credentials are generated with Web Crypto in the browser. The Setup URI is encrypted, its passphrase is shown separately, and neither value is uploaded merely by preparing the check. Their read-only fields disable browser autocomplete and spell-check; copying either value to the system clipboard remains an explicit user action. Starting monitoring uses the configured signalling relay, which is the existing public relay by default, and exposes the usual P2P signalling metadata to that service. WebRTC and optional relay or TURN behaviour retain their existing Commonlib security and privacy properties.

The production page does not accept a relay override from a deployed origin. A `relay` query parameter is honoured only when the page itself is served from a loopback host, and only for `ws:` or `wss:` URLs. This narrow boundary allows the real-Obsidian E2E scenario to use the local Compose relay without making an arbitrary relay query part of the hosted user workflow.

The generated configuration is disposable. It must be used only in a dedicated empty Vault, must not replace a production Vault's settings, and must not be retained as the credentials for a later production setup. The browser page stores no ordinary Vault files for this workflow, although browser-local database infrastructure is opened to satisfy the existing WebPeer runtime contract.

## Alternatives rejected

### Display the result in the LiveSync plug-in

The observation belongs to the browser reference peer and does not prove LiveSync document synchronisation. Keeping the result beside the QR code makes the evidence and its owner explicit.

### Use browser, desktop, and mobile simultaneously as the primary comparison

The diagnostic totals are cumulative and do not attribute an `RTCPeerConnection` to a named target device. Separate random rooms provide a clearer result. Same-room reuse is retained only as an explicit convenience, with a counter baseline and another simultaneous active connection required for its result.

### Treat any failure increment as a final failure

Negotiation can fail and then retry successfully. A later successful increment takes precedence over earlier failure increments.

### Treat browser success as proof of device-to-device synchronisation

Browser-to-device success is a useful preflight check, but it does not exercise the exact desktop-to-mobile network path or a LiveSync note round trip.

### Put the Setup URI passphrase in the QR code

Keeping the encrypted URI and passphrase separate preserves the existing Setup URI boundary and avoids turning one captured QR code into the complete configuration secret.

### Distribute one standalone downloaded HTML file

WebPeer already depends on a compiled module graph, origin-scoped storage, and secure browser capabilities. A hosted production build reuses those boundaries and can be updated consistently; a single self-contained file would require a separate bundling and trust model.

## Verification

Unit tests decode each generated Setup URI and verify its isolation identifier, random credentials, remote-profile selection, automatic-start policy, absence of a device-local name, and browser-only diagnostic setting. Pure outcome tests cover waiting, failed attempts, later success, and closure after success.

The WebPeer browser smoke test verifies that the production page can prepare a desktop or mobile check, render the QR code, display a separately formatted passphrase, expose zeroed counters without contacting the signalling relay, and return to the unchanged QR code. Pure tests verify that a reconnect which replaces the first connection does not satisfy the same-room additional-connection rule. The focused real-Obsidian E2E test serves the production page from loopback, starts the local Compose Nostr relay, applies the browser-generated Setup URI through visible onboarding in one empty Vault, records the same-room baseline, reuses the unchanged URI in a second empty Vault, and requires the browser to observe another simultaneous active connection before retaining a result screenshot. Existing Commonlib tests remain authoritative for diagnostic WebRTC wrapping, Trystero negotiation, and P2P lifecycle behaviour.

## Consequences

- Users can assess whether P2P is plausible on each intended device and network before relying on it.
- Results remain visibly scoped to connectivity rather than synchronisation correctness.
- A fresh test requires a fresh page session and disposable empty Vault; same-room reuse requires another empty Vault and retains cumulative counters.
- CouchDB remains the recommended predictable option when representative P2P checks repeatedly fail.
- Direct device-to-device note transfer remains a separate, optional verification step.
