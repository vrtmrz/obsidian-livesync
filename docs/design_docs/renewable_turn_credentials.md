---
date: 2026-09-16
commonlib-version: "0.1.25"
self-hosted-livesync-version: "1.0.28"
status: unreleased
---

# TURN credentials in P2P connection settings

## Purpose

This design addresses [Issue #1182](https://github.com/vrtmrz/obsidian-livesync/issues/1182)
by acquiring temporary TURN credentials on the device before opening a P2P room.
The [P2P transport compatibility ADR](../adr/2026_08_p2p_transport_compatibility.md)
records the connection and persistence policy.

LiveSync prepares a connection copy of `P2PSyncSetting`. Commonlib owns the room
lifecycle and consumes the resulting ICE settings. Service-specific HTTP and
validation remain under `src/integrations/`; Commonlib has no provider catalogue
or versioned acquisition descriptor. Cloudflare is the first optional integration.
Manual TURN configuration remains available without a provider account.

## Settings and ownership

| Setting | Meaning | Lifetime |
| --- | --- | --- |
| `P2P_managedType` | Provider identifier; `CF` selects Cloudflare | P2P profile |
| `P2P_managedId` | Provider key identifier; Cloudflare TURN Key ID | P2P profile |
| `P2P_managedToken` | Provider API token used to request credentials | P2P profile |
| `P2P_iceServers` | Prepared `RTCIceServer[]` | One room connection |
| `P2P_iceServersExpiresAt` | Absolute expiry in Unix milliseconds | One room connection |

The first three values use ordinary ConnStr query parameters `managedType`,
`managedId`, and `token`. The existing `appId` parameter continues to identify the
P2P application. Commonlib reads and writes the three scalar values so profile
editing and activation preserve them. The host interprets the provider identifier.
An absent identifier selects the existing manual fields; an unsupported identifier
produces an explicit error when a connection is requested.

Keep `P2P_turnServers`, `P2P_turnUsername`, and `P2P_turnCredential` for manual
configuration. Issuance does not overwrite them. Retain the complete ICE array:
individual entries can contain different credentials or STUN-only URLs.

## Host preparation

The optional `prepareP2PSettings(settings, signal)` composition hook receives a
snapshot of requested P2P settings. LiveSync supplies the same preparation function
to Obsidian, CLI, WebApp, and WebPeer using each host's HTTP adapter.

For a managed selection, the function validates the provider inputs, requests
credentials, and returns a connection copy:

```typescript
return {
    ...settings,
    P2P_iceServers: iceServers,
    P2P_iceServersExpiresAt: expiresAt,
};
```

Commonlib takes the prepared ICE fields into its session snapshot and passes that
snapshot through `ReplicatorHostEnv.settings`. The hook does not change the
requested room identity, persist settings, own replication, or schedule renewal.
Its HTTP request must settle on cancellation and has a bounded deadline. The room
owner also stops waiting for preparation when the connection request is retired.
An explicitly managed configuration requires a preparation hook and usable ICE
credentials; acquisition failure does not select a fallback provider or route.
Managed credential acquisition is independent of the connection path. `Automatic`
retains normal ICE selection, including direct candidates; only `TURN relay only`
forces relay use. Acquisition must still succeed before opening a managed room
when `Automatic` is selected.

## Room reuse and expiry

The active connection settings hold the issued credentials. They are the only
credential cache. The existing room reuse decision checks:

1. whether the requested database and connection settings still match; and
2. whether the active connection's credentials have enough remaining lifetime.

The static connection signature includes the provider type, key ID, and token.
It excludes the generated ICE array and expiry. Comparing the prepared and stored
settings directly would incorrectly trigger issuance on every reconciliation.

When reuse is unavailable, the owner retires the existing room, obtains a fresh
connection copy, and opens its replacement. It checks settings, room demand,
cancellation, and expiry again before publishing the replacement. A late result
cannot reopen a closed room or apply credentials requested for different settings.
Explicit reconnection acquires fresh credentials. Closing the room releases its
credential references. Preserve a 30-second connection-establishment margin.

Reconciliation runs at existing connection, settings, and lifecycle boundaries.
Time passing alone does not trigger acquisition or disconnection. There is no
renewal timer, per-peer acquisition, raw WebRTC configuration update, ICE restart,
or general retry mechanism. Trystero's internal peer reconnection within an
unchanged room uses that room's existing configuration.

Normal retirement may cancel an in-progress transfer. A later replication attempt
uses stored checkpoints and revision comparison to retain received progress.
An unfinished network message may be sent again. Whether another attempt starts
automatically continues to follow the existing synchronisation policy.

## Persistence, sharing, and privacy

Persist provider values only inside the selected P2P profile URI. Flat values in
runtime settings are a projection restored by profile activation. Profile edits
update that URI explicitly. General settings saves do not rebuild a P2P profile
from unrelated flat settings. Flat-settings migration creates and selects its
P2P profile once, independently of the selected main remote.

Existing whole-profile encryption covers the saved API token. The default mode
uses the existing built-in key; a user-supplied configuration passphrase has its
existing protection semantics. Failure to encrypt a managed profile leaves the
previous saved data intact. No separate encrypted-token field is added. A draft
containing provider credentials but no Group ID remains unsaved.

Setup URIs and ordinary settings QR codes already contain `remoteConfigurations`.
The provider values travel inside that profile URI, including inactive profiles.
Omit their duplicate flat projections from sharing. No new URI scheme, encoded QR
slot, or encryption envelope is needed. Setup URIs retain passphrase encryption;
QR codes retain their unencrypted format and 'FOR YOUR EYES ONLY' display.

Issued ICE credentials and expiry appear only in connection copies. Remove both
runtime fields at save, import, and sharing boundaries, including
`TrysteroReplicator.getAllConfig`, which starts from the session settings.
Incoming settings cannot install an issued credential override. Reports omit
runtime ICE fields, redact provider values, and retain scheme-only profile URIs.
Logs use safe errors and omit request headers, raw responses, and connection
signatures. Ordinary plaintext in process memory is permitted.

Markdown settings omit managed provider values and the profile collection with
its selections. If that group is omitted during import, preserve the corresponding
local P2P connection values as well as the profiles. This prevents combining an
imported room with the local provider token or overwriting the saved profile.

## Cloudflare integration

The UI presents `Manual` and `Managed (Cloudflare)`, with `TURN Key ID` and a masked
`TURN Key API Token` input for Cloudflare. It requires no account ID, custom
endpoint, SDK, credential broker, or renewal interval setting.

The provider function uses Cloudflare's
[credential-generation endpoint](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
and converts its response into ICE servers. The implementation requests a fixed
24-hour lifetime and derives local expiry from the clock before the request starts.
This lifetime applies to the issued TURN credentials, not the provider API token.
There is currently no setting to change it.

The HTTP boundary uses the injected standard fetch adapter with cancellation,
a 15-second deadline, refused redirects, omitted cookies, and disabled caching.
It bounds the response to 32 KiB, 16 ICE entries, and 32 URLs, and validates URLs
and complete TURN credentials. These are local implementation limits. Keep this
validation at the provider boundary instead of repeating it in Commonlib.

The token is supplied and shared by the user on their devices. The provider
function sends the key ID, API token, and requested lifetime; it has no need for
Vault data, the Group ID, or the Vault passphrase.

## Setup and verification

The Setup connection test remains a signalling check. A separately owned trial
uses signalling-only settings and performs no managed TURN issuance. The existing
active-relay admission rule still applies. Success does not verify the API token,
TURN allocation, or document transfer. Actual room connections use the preparation
hook and preserve the selected route policy on failure.

Focused tests cover provider validation and cancellation, room reuse and expiry,
late results after configuration changes or closure, migration without duplicate
profiles, Markdown import through save/reload, safe acquisition failures, and
exclusion of runtime credentials from storage and sharing.

Validate Commonlib as an exact packed artefact before testing its LiveSync
consumer. Verify the changed settings and restart boundary in real Obsidian.
Previously observed provider issuance and relay synchronisation do not establish
expiry-driven reconnection for a revised build. Fresh TURN allocation after
expiry, mobile runtimes, and cross-network behaviour require their own runtime
verification; a surviving Trystero shared peer is not evidence of new allocation.
