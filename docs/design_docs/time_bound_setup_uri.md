---
date: 2026-09-28
commonlib-version: "0.1.33"
feasibility-probe-version: "0.1.27"
self-hosted-livesync-version: "1.0.32"
status: implementing
---

# Time-bound Setup URIs

## Purpose and status

Offer two modes when generating a [Setup URI](../glossary.md):

- **Ephemeral**, selected by default, derives an effective passphrase from the
  entered passphrase and the current fixed time window.
- **Persistent** uses the entered passphrase and the existing URI format
  unchanged. It also serves as the compatibility mode for older readers.

The generation mode choice shows the exact time until which an Ephemeral URI
can be opened through the ordinary reader. Import still requires only the URI and
the entered passphrase. Neither the mode nor a timestamp is stored in the URI.

The design is technically feasible with the existing encryption primitives.
An executable protocol probe passes 22 cases against Commonlib 0.1.27 and
octagonal-wheels 0.1.54. The implementation was first published as Commonlib 0.1.32
on the npm `next` tag. LiveSync now pins Commonlib 0.1.33 from that tag in its npm
dependency and independent Deno tool imports. A mobile performance bound remains
outstanding.

This document records the proposed key derivation and integration contract. The
companion probe demonstrates them without changing an application entry point.

## Scope

The first version offers Ephemeral and Persistent only. Ephemeral uses one
fixed seven-day window shared by every implementation. Arbitrary start dates,
custom end dates, selectable window lengths, and rolling seven-day lifetimes
are outside this version.

Keep the current settings filtering, remote profiles, main and P2P selections,
and short/full export variants. Time binding affects opening the exported
settings; it does not alter Vault encryption, remote credentials, replication,
or settings already imported by another device.

The existing `settingsQR` format and QR aggregator are separate sharing paths.
They remain outside this design and must not be presented as time-bound.

## Time window

Use Unix milliseconds and the following protocol constants:

```text
windowMilliseconds = 604800000
windowNumber = floor(nowMilliseconds / windowMilliseconds)
windowStart = windowNumber * windowMilliseconds
usableUntil = (windowNumber + 1) * windowMilliseconds
```

The anchor is the Unix epoch, `1970-01-01T00:00:00Z`. Consequently, boundaries
fall on Thursdays at 00:00 UTC. This is a protocol convention, independent of
the device's locale, time zone, daylight-saving rules, and calendar week.
The anchor and window length are part of the derivation profile. Changing them
requires an explicit compatibility design; there is no visible version field
from which an importer can discover a different time condition.

For example, a URI generated at `2026-09-28T12:00:00Z` belongs to the window
`[2026-09-24T00:00:00Z, 2026-10-01T00:00:00Z)`. Ordinary import rejects it at
the end instant. Generating it one second before that instant leaves one
second of availability. The UI must not describe this as seven days from
generation.

Use safe, non-negative integer timestamps without 32-bit coercion. The
reader tries only its current window. There is no previous-window allowance,
future-window search, modulo wraparound, or grace period. Devices whose clocks
fall on different sides of a boundary can disagree; local date formatting
does not affect the calculation.

## Passphrase derivation and encryption

The time factor follows the counter construction used by
[TOTP, RFC 6238 section 4.2](https://www.rfc-editor.org/rfc/rfc6238.html#section-4.2).
This is a time-bound encryption format, not a TOTP authentication protocol:
there is no six-digit code, trusted validation server, or single-use state.

Reuse Commonlib's current `encryptString` and `decryptString` path. It uses
octagonal-wheels' salted PBKDF2/HKDF and AES-GCM implementation. Persistent
passes the entered passphrase directly to that path. Only Ephemeral applies
a full-length transformation:

```text
if mode == "persistent":
    effectivePassphrase = enteredPassphrase
else:
    hmacKey = SHA-256(UTF-8(enteredPassphrase))
    context = JSON.stringify([
        "livesync/setup-uri",
        "tb1",
        "ephemeral",
        windowNumber
    ])
    effectivePassphrase = lowercaseHex(HMAC-SHA-256(hmacKey, UTF-8(context)))
encryptedSettings = encryptString(preparedSettingsJSON, effectivePassphrase)
```

The mode strings are exactly `ephemeral` and `persistent`. JSON encoding,
field order, lowercase hexadecimal, and the domain/profile strings are part
of the proposed Ephemeral derivation. `tb1` is an internal derivation identifier;
it is not a URI prefix or stored field. Persistent applies no new transformation.

The initial SHA-256 provides a fixed-length HMAC key, including for an empty
low-level input. It does not replace password stretching: the existing
encryption function still performs PBKDF2. Do not trim or normalise the
entered passphrase within this transformation. Existing host requirements for
a non-empty passphrase remain in force; this design adds no new password
policy.

At the assessed dependency versions, the encryption path uses PBKDF2-SHA-256
with 310,000 iterations, HKDF-SHA-256, and AES-256-GCM with a 128-bit tag. Its
`%$` payload includes the material needed for decryption. The PBKDF2 salt may
be reused within a session; the IV and HKDF salt are generated for each
encryption. Retain these existing semantics rather than claiming a new
per-URI PBKDF2 salt or introducing another encryption implementation.

For the synthetic passphrase `test-passphrase`, fixed derivation vectors are:

```text
context: ["livesync/setup-uri","tb1","ephemeral",1234]
effectivePassphrase: b39361c51f0b7bd835554db1dffbc9a540fb30789aa62bf53e39e07d1073013b

mode: persistent
effectivePassphrase: test-passphrase
```

The probe checks the Ephemeral Web Crypto output against a value calculated
separately through Node's SHA-256 and HMAC interface, and checks that Persistent
retains the exact input. Encryption remains randomised; these vectors specify
the effective passphrase, not the complete URI.

This composition needs Commonlib changes but no new cryptographic dependency
or remote service. The prototype verifies interoperability with the existing
encryption path; it is not an independent cryptographic audit.

## URI format and decoding

Keep the existing URI prefix and encrypted representation without a new marker:

```text
obsidian://setuplivesync?settings=<encodeURIComponent(encryptedSettings)>
```

Both modes use the existing `%$` encrypted representation. There is no mode
flag, timestamp, window number, duration, derivation-version marker, or separate
query parameter. For identical prepared settings, both modes have the same
binary layout and ciphertext length. Percent-encoded text length may vary with
the random ciphertext; equal URI text length is not a requirement.

Persistent delegates to the existing encoder with the entered passphrase and
the same settings-filtering options. A new marker or a transformed Persistent
passphrase would defeat older readers. Ephemeral uses the same external format
to preserve mode hiding. The protocol handler continues to reconstruct the URI
from the existing `settings` query value.

For a `%$` payload, including an existing URI made before this feature, the
updated decoder:

1. validates the envelope and captures the current window;
2. derives the Ephemeral candidate for that window and takes the entered
   passphrase unchanged as the Persistent candidate;
3. attempts authenticated decryption with both candidates, without returning
   early after the first success;
4. checks the current window again before returning an Ephemeral result; and
5. returns settings only if exactly one candidate is accepted.

Keep expected candidate failures internal. Two failed candidates produce one
generic opening failure. A wrong passphrase, an out-of-window Ephemeral URI,
and damaged authenticated ciphertext do not receive different user messages.
There is no information from which to report a definite historical end time
for an unreadable URI.

The raw-passphrase attempt is an intentional part of the two-candidate reader.
An Ephemeral URI from another window still fails both candidates with the
entered passphrase; this attempt does not remove its time condition. There is
no plaintext recovery, time-window search, or additional key fallback.

Older encryption representations other than `%$` retain their existing
legacy-only decoder and passphrase handling. Unsupported prefixes remain
unsupported. Malformed `%$` payloads fail authentication with both candidates.
Bound time-bound candidate work to two attempts; the existing decoder continues
to own any historical encryption-format compatibility trials.

Because the derivation profile is not stored, an older reader cannot identify
an Ephemeral URI and give an upgrade-specific error. It reports a decryption
failure. A future change to the Ephemeral profile must define its bounded
candidate policy explicitly; the reader must not infer arbitrary profiles or
scan them without a limit.

Two trials make the amount of cryptographic work predictable, but do not
constitute a constant-time implementation. This design does not claim to hide
the mode from a caller who can instrument the decoder and knows the passphrase.

## Generation and import interaction

Keep the existing passphrase prompt. After it, use the existing confirmation
dialogue to choose Time-bound (the Ephemeral encoder mode) or Compatible (the
Persistent encoder mode). Select Time-bound by default, show its exact absolute
end in the device's local time zone with its time-zone name or UTC offset, and
explain that this is the end of a fixed UTC window rather than seven days from
generation. Compatible has no time condition and remains readable by older
clients. No synchronised setting or permanent Vault preference is needed.

Commonlib exposes the current window end for this pre-generation choice.
Compare it with the `usableUntil` returned alongside the generated URI. If
the window changed during selection or encryption, show a fresh choice with
the new end before opening the existing copy dialogue. Persistent generation
does not consult the clock and returns `null` for `usableUntil`.

The existing copy dialogue does not monitor the clock. If it stays open across
the boundary, it can still display and copy a URI whose window has ended;
the reader will reject that URI. The end time was shown at the mode choice.
The copy dialogue does not claim a rolling week or silently switch to
Compatible.

Import requires no mode selector or date input. Recheck the window at the
end of decryption so that an Ephemeral operation crossing the boundary does
not return settings. Once settings have been returned successfully, subsequent
confirmation, setup, and synchronisation do not remain time-bound: the URI
has already been opened. This is an import boundary, not remote revocation.

## Security and privacy boundary

The hidden mode is an external-format property. A passive holder of the URI
does not receive an explicit time condition or Persistent marker. Randomised
encryption and the unchanged prepared settings representation avoid adding
a mode-dependent field or length difference.

The clock and reader are controlled by the receiving device. Anyone with the
correct passphrase can reproduce historical candidates, modify the reader,
or change the supplied clock. Including Persistent adds one possible
candidate; it does not make a small calendar search cryptographically hard.
Time binding adds no independent secret and is not a substitute for a strong
Setup URI passphrase.

The same URI can be opened repeatedly within its window. A replayed clock
earlier than generation, but inside that same window, also derives the same
key. Successfully copied settings and remote credentials remain usable after
the window ends, subject to their own remote policies.

No URI, entered or effective passphrase, derived key, decrypted settings, or
candidate-specific authentication result should enter ordinary logs or reports.
The generation screen necessarily reveals the selected mode and end time to
its user; hiding information in the URI does not hide that screen or a
separately shared message.

## Ownership and compatibility

Commonlib owns preparation of exported settings, the time-window calculation,
passphrase derivation, format parsing, and dual-candidate decoding. Make these
changes in the Commonlib repository. LiveSync must consume a validated packed
artefact and then an exact reviewed package version, following
[the Commonlib dependency workflow](../../devs.md#commonlib-dependency).

Preserve the existing positional encoder API. Its third and fourth arguments
already mean properties to remove and whether to omit default values. Add a
separate encoder, provisionally `encodeTimeBoundSetupURI`, with an options
object containing the mode and the existing export options. Its result is:

```typescript
type TimeBoundSetupURIResult = {
    uri: string;
    usableUntil: number | null;
};
```

The new encoder defaults to Ephemeral. Preserve the old encoder's legacy
behaviour for callers which have not migrated. Extend
`decodeSettingsFromSetupURI` to try both candidates for `%$` while retaining its
settings return contract and historical format handling. Persistent generation
through the new API delegates to the old encoder. Time injection belongs in
internal test seams, not an import option exposed to users.

| Surface                                                                              | Required work                                                                                                                                            |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Obsidian generation](../../src/serviceFeatures/setupObsidian/setupUri.ts)           | Reuse the passphrase and copy dialogues, add a mode choice with the exact current window end, and use the new encoder for all three copy variants and the copy event. Preserve each variant's export filters.                 |
| [Obsidian import](../../src/modules/features/SetupWizard/dialogs/UseSetupURI.svelte) | Consume the updated decoder and retain one authentication failure message. The existing prefix check indicates URI shape, not successful authentication. |
| [Protocol handler](../../src/serviceFeatures/setupObsidian/setupProtocol.ts)         | Keep the existing `settings` reconstruction; test encoded delimiters for both modes.                                                                     |
| [CLI setup](../../src/apps/cli/commands/runCommand.ts)                               | Consume the updated decoder and leave settings unchanged after any rejection.                                                                            |
| [WebPeer generator](../../src/apps/webpeer/src/P2PCheckSetup.ts)                     | Choose a mode explicitly and return availability to its result UI; keep Ephemeral as the default.                                                        |
| [Setup utility](../../utils/setup/generate_setup_uri.ts)                             | Add an explicit mode input, default to Ephemeral, and return/print the end time. Persistent is an explicit choice for durable provisioning output.       |
| [Setup utility package facade](../../utils/setup/livesync-commonlib.ts)              | Update its independent Commonlib pin and associated lockfiles; updating the root npm dependency alone is insufficient.                                   |

The Fly.io wrapper delegates to the setup utility and should inherit the same
contract. All maintained generators must migrate explicitly before this
feature is described as the default across applications. Non-interactive
automation which needs a durable URI must select Persistent.

WebPeer hides an Ephemeral URI and disables its copy and additional-device
actions after the window ends. Its connection monitor remains available for a
device that imported the URI before the end; opening the URI does not expire
the imported P2P credentials.

| URI            | Updated reader                                          | Reader without time-bound support |
| -------------- | ------------------------------------------------------- | --------------------------------- |
| Legacy         | Existing behaviour, without a time condition            | Existing behaviour                |
| New Ephemeral  | Opens in the current window with the correct passphrase | Rejected                          |
| New Persistent | Opens with the correct passphrase                       | Existing behaviour                |

The assessed, unchanged Commonlib 0.1.27 decoder opens Persistent with the
entered passphrase and rejects Ephemeral with that same passphrase. Persistent
compatibility means compatibility with readers which already support the
ordinary generated `%$` representation; it does not add that representation
to still older readers. Historical supported versions and their settings
schemas still need compatibility fixtures before rollout.

Keep the original raw-passphrase behaviour of existing URIs. They are
indistinguishable from newly generated Persistent URIs to the updated reader.
The previous marked-envelope sketch rejected an added Persistent compatibility
case with `Unsupported encryption format`. The same synthetic settings and
entered passphrase now open through the unchanged decoder, while separate
tests retain old-reader rejection of Ephemeral and rejection outside its window.

## Feasibility evidence and validation

The [executable design probe](time_bound_setup_uri.probe.mjs) uses Web Crypto
for the proposed transformation and the actual Commonlib encoder/decoder for
settings filtering and encryption. It is an isolated specification exercise;
it is not imported by an application or registered in the production test suite.

Run it after installing the dependency versions assessed by this document:

```sh
NODE_OPTIONS=--max-old-space-size=512 node docs/design_docs/time_bound_setup_uri.probe.mjs
```

Alternatively, pass the directory of an unpacked Commonlib 0.1.27 package as
the first argument. Its module resolution must supply octagonal-wheels 0.1.54
and the remaining declared dependencies. The probe verifies the Commonlib
version before running; it does not install or download packages.

The assessment used Node.js 24.18.0 and registry artefacts for Commonlib 0.1.27
and octagonal-wheels 0.1.54, verified against the lockfile's SHA-512 values.
All 22 cases passed:

- fixed Ephemeral derivation checked through Web Crypto and Node HMAC, and an
  unchanged Persistent passphrase;
- current-window success, previous/later-window rejection, and exact end;
- Persistent across distant timestamps and both candidate attempts on success;
- wrong-passphrase rejection and a shared external format;
- stable end-time metadata and randomised repeated encryption;
- legacy import, old-reader acceptance of Persistent, and old-reader rejection
  of Ephemeral;
- unsupported-prefix, malformed-ciphertext, and ciphertext-tampering rejection;
- Persistent generation without reading the clock;
- protocol query decoding/re-encoding;
- generation and import crossing a boundary;
- equivalent timestamps expressed with different UTC offsets;
- Unicode, whitespace, empty low-level passphrase input, and distinct Ephemeral
  and raw-passphrase candidates;
- the deliberate limitation that clock rollback reproduces an old key.

This demonstrates the proposed mechanism and baseline interoperability, not
completed application support, formal mode indistinguishability, or a mobile
latency bound. The present encryption API may perform two PBKDF2 derivations
on a cold import. Do not infer production performance from this small probe,
whose operations can reuse the dependency's in-memory key cache.

Implementation validation must cover Commonlib unit and packed-package tests,
plus shared fixed-input protocol vectors across consumers. Add targeted LiveSync
tests for the generation metadata, cancellation, a window change during mode
selection, encoded deep links, and rejected imports without settings writes. Extend CLI, WebPeer,
and Deno setup-tool round trips, including their Persistent selection.

Then run the required LiveSync checks, unit suite, and production build, one
broad process at a time with `NODE_OPTIONS=--max-old-space-size=3072` and bounded
test workers. Use the existing focused real-Obsidian Setup URI workflow for
copy/paste, deep-link import, cancellation, and successful setup. Verify
selection-boundary handling with an injected test clock and mobile behaviour on a
supported runtime; do not change the host's system clock. No remote database
service is needed for the protocol tests themselves.

There is no identified blocker in the Time-bound URI protocol. The Commonlib
candidate based on 0.1.31 passed its type, unit, boundary, release-process,
and packed-package gates before the 0.1.32 release. A clean `npm ci` against
the published 0.1.32 artefact and the frozen Deno tool lock resolve the same
registry integrity. LiveSync passes its source checks, production build, and
1,034 unit tests on a local stack with [PR #1222](https://github.com/vrtmrz/obsidian-livesync/pull/1222).
The two CLI installer tests need a runner which permits child processes; both
pass under normal process permissions. The Deno setup-tool suite, CLI setup
and file-operation contract, and WebPeer browser tests passed before stacking.

Focused real-Obsidian generation checks pass on desktop and emulated mobile,
including the displayed Time-bound end, Compatible output, and mobile touch
targets. A two-device CouchDB workflow now passes on the local stack: the
provisioning tool creates a generation 12 database, the first device generates
a Time-bound Setup URI after declaring its required generation 13 feature, and
the second device imports it. An ordinary note completes a round trip, and a
hidden snippet synchronises. The separate real-Obsidian tests for live remote
feature changes, internal Metadata migration, and a percent-prefixed E2EE
passphrase also pass with published Commonlib 0.1.32. Unit and protocol tests
cover window boundaries and preserve the existing distinction between an empty
passphrase and cancellation. The WebPeer browser test confirms that its monitor
remains available after the URI window ends for a device which has already
imported the URI.

The subsequent update to published Commonlib 0.1.33 passes a clean `npm ci`,
matching npm and frozen Deno lock integrity, source checks, the production build,
1,042 unit tests, and eight Deno setup-tool tests. A consumer check of the public
hashing entry covers key changes, E2EE suspension, and cache retirement. The real
Obsidian two-Vault workflow also passes ordinary and encrypted note transfers.

The downstream change depends on PR #1222's host compatibility integration;
relaxing only the version check would bypass its compatibility contract. These
results do not establish a mobile performance bound. The first implementation
changes only primary-language resources; translation changes require separate
scope.
