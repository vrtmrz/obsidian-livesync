---
date: 2026-09-29
commonlib-version: "0.1.33"
self-hosted-livesync-version: "1.0.32"
status: unreleased
---

# Configurable ID derivation

## Purpose and baseline

Introduce an optional, saved secret for deterministic Chunk IDs and obfuscated
Metadata document IDs. This allows an E2EE passphrase to change without also
changing those IDs, and allows their derivation to use an independent secret.
Identical inputs must produce identical IDs on participating devices so that
Chunks can be reused and edits to the same path share one document identity.

The baseline is [PR #1222](https://github.com/vrtmrz/obsidian-livesync/pull/1222),
including its passphrase-persistence correction at commit
`126d6eadb858a79a08ad7f600061e54fc8d31196`. Commonlib `0.1.33`, published with
the `next` tag, provides the construction described here. It replaces the
independent Chunk algorithm from the `0.1.32` prerelease without a
compatibility branch or a new settings version. Legacy ID generation remains
unchanged. LiveSync pins the published `0.1.33` package and its registry
integrity in the lockfile.
Its [Internal Metadata encryption design](https://github.com/vrtmrz/obsidian-livesync/blob/126d6eadb858a79a08ad7f600061e54fc8d31196/docs/design_docs/internal_metadata_encryption.md)
remains the basis for Properties encryption and CouchDB feature admission.
This document records an unreleased LiveSync feature. It does not select a
plug-in release version.

## Feasibility

The change is feasible within the existing architecture. Commonlib already
centralises Chunk hashing, path-to-ID conversion, settings persistence, and
Setup URI encoding. Chunk reads follow stored IDs, so changing the generator
does not require a new Chunk reader or content representation.

The work spans Commonlib and its consumers. The principal constraints are
agreement on document IDs, complete propagation of the saved secret, and cache
behaviour after a setting change. The construction and transport-specific
agreement checks are described below. No database migration framework is
required.

## Scope

| Value or operation                                 | Proposed behaviour                                                                                                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encrypted Chunk IDs                                | Use the saved ID secret in the new mode. Keep legacy generation when the option is absent.                                                                                                            |
| Obfuscated Metadata document IDs                   | Use the same saved secret with a separate derivation purpose. Preserve existing path normalisation and namespace handling, including ordinary files, `i:`, `ix:`, and supported legacy `ps:` entries. |
| Unobfuscated document IDs                          | Retain the current path-based identity.                                                                                                                                                               |
| Content and Properties encryption                  | Continue using the E2EE passphrase and existing encryption format.                                                                                                                                    |
| CouchDB/PouchDB `_rev`                             | Retain existing revision generation and replication behaviour.                                                                                                                                        |
| Internal content digests and transport bookkeeping | Retain existing behaviour unless they directly construct one of the IDs above.                                                                                                                        |

Document IDs are already assigned in the local database. Properties encryption
protects the path and other fields during transfer, while preserving `_id`.
Consequently, the saved ID secret must reach local path conversion as well as
remote-facing code. Path Obfuscation continues to control whether this
conversion is used; this proposal does not enable it automatically.

Journal keys which incorporate document IDs inherit the resulting IDs. They do
not need another secret. Content digests inside encrypted Customisation Sync
content also do not need a separate setting.

Automatic migration or enablement of existing or already migrated users,
Setup URI expiry or revocation, QR format security changes, revision redesign,
remote-only E2EE passphrase rotation, and a new remote configuration management
protocol are outside this change.

## Input and saved state

New Vault setup selects independent ID derivation and a random source by
default when E2EE is enabled. An existing Vault with no saved key retains
legacy mode until the user selects a new key explicitly. The setup dialogue
shows three radio choices:

1. Keep current configuration, selected by default for an existing Vault. It
   retains the saved key when present and otherwise retains legacy ID
   generation. A small description below this choice shows which configuration
   is currently saved. In legacy mode, changing the E2EE passphrase still
   changes IDs.
2. Generate a random ID key, selected by default for a new Vault.
3. Set an ID key. Three nested radio choices derive it once from the current
   E2EE passphrase, accept a source string, or import a tagged recovery code.
   Only the latter two show the text input.

The action is not persisted. An ordinary source is converted to a key when the
settings are applied, and then discarded. A tagged `sls-id-v1:` recovery code
imports its exact 256-bit key without deriving it again, including when pasted
into the source-string input. The recovery-code choice accepts only tagged
codes. A malformed tagged code is rejected. If either input is empty, a saved
key is kept; without a saved key, the dialogue requests input. Changing the
E2EE passphrase later preserves the saved ID key. Cancelling or failing to
save preserves the previous settings.

The source itself cannot be recovered from its key. A user can explicitly
display and copy the saved key as a tagged recovery code on the local device;
it is hidden when the dialogue opens. The dialogue warns that anyone who needs
recovery after losing every device should save that code or choose a source
they can reproduce.
Turning E2EE off retains the saved value but suspends its use for ID generation.
The setup dialogue disables new ID-key configuration while E2EE is off. Turning
E2EE on again reactivates the same value. Existing E2EE re-encryption and
Rebuild requirements still apply when the passphrase changes.

The source-input warning concerns only that input. The E2EE passphrase retains
its separate, existing storage behaviour. The recovery code contains the actual
saved ID key and must be handled as a secret.

Settings need to represent legacy mode or a supported version plus a derived
secret. Final field names belong in Commonlib. A declared new version with a
missing, malformed, or unavailable secret is an error; it must not silently
fall back to legacy generation. Loading or exporting an already derived value
must not derive it again.

## Deterministic derivation

The required contract is:

```text
source string --versioned derivation at save--> saved ID secret
saved ID secret + Chunk content ------------> Chunk ID
saved ID secret + canonical path -----------> obfuscated document ID
E2EE passphrase ----------------------------> content and Properties encryption
```

Derivation is offline and deterministic across supported runtimes. Its version
fixes the text encoding, treatment of Unicode and whitespace, salt, parameters,
and saved representation. It must not depend on server state, the E2EE Security
Seed, a device identifier, time, or device-specific iteration calibration.
Repeated saving of the same source under the same version produces the same
value. Reusing that source in another Vault consequently also reuses the value.

Version 1 uses PBKDF2-HMAC-SHA-256 with 310,000 iterations, the UTF-8 bytes of
the source after NFC normalisation, the fixed salt
`self-hosted-livesync:id-source:v1`, and a 256-bit output encoded as 64 lowercase
hexadecimal characters. Whitespace is preserved. The existing
`idDerivationVersion: 1` setting, saved-settings fields, and recovery-code format
remain unchanged; this implementation change does not add an ID format version
or migration path.

Obfuscated document IDs continue to use the saved 256-bit value directly as the
key for full HMAC-SHA-256. Their message remains UTF-8 encoding of
`self-hosted-livesync:id-v1:document`, a NUL byte, and the canonical path.
Agreement proofs likewise retain their existing full-HMAC messages. Neither
path uses the new Chunk-specific cache.

For encrypted Chunk IDs, first compute xxHash64 over the UTF-8 bytes of the
exact Chunk text with seed 0. Encode its result as a fixed 16-character
lowercase hexadecimal prehash. Derive a Chunk-specific subkey from the saved
32-byte value, then HMAC the domain-separated prehash:

```text
Kchunk = HMAC-SHA-256(
  saved 32-byte key,
  UTF8('self-hosted-livesync:id-v1:chunk-key:xxhash64')
)
prehash = fixed16lowerhex(xxHash64(UTF8(exact Chunk text), seed 0))
Chunk ID = full64lowerhex(HMAC-SHA-256(
  Kchunk,
  UTF8('self-hosted-livesync:id-v1:chunk:xxhash64' + NUL + prehash)
))
```

The resulting Chunk ID is the full 64-character lowercase hexadecimal HMAC
output. Existing namespace prefixes remain outside the digest. Keyed Chunk IDs
use this fixed prehash regardless of `hashAlg`; legacy mode and its existing
hash selection remain unchanged.

The Chunk-specific HMAC subkey and imported key, along with the WASM xxHash64
generator, are cached per `HashManager` and active saved key. Concurrent
preparation is shared. Replacing the manager or key, turning E2EE off, or
returning to legacy mode clears the cache; failed preparation can be retried.
This cache adds no persistent state. The current E2EE setting also selects the
legacy encrypted or plain Chunk route when a manager remains alive while E2EE is
turned off.

### Security properties and limits

A derived value remains a secret capable of generating IDs. Hashing does not
increase the entropy of its source. A password KDF adds guessing cost; it does
not make a weak source strong. HKDF alone does not provide that password
stretching. See [RFC 8018](https://www.rfc-editor.org/rfc/rfc8018.html#section-8)
and [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869.html#section-4).

The random default separates ID generation from the E2EE passphrase. Deriving
both secrets from the same source retains a relationship with the original
passphrase, even after that passphrase changes. An independent source with
sufficient entropy provides the intended separation. HMAC with purpose
separation is the construction for using that secret; see
[RFC 2104](https://www.rfc-editor.org/rfc/rfc2104.html).
The fixed derivation salt means that reusing a source across Vaults reuses the
ID key; use separate sources when independent Vault identities are required.

CouchDB authentication and database access control remain the first access
boundary. This design also considers exposure through database credentials,
server administration, or backups. It does not promise to conceal equality,
document counts, revision history, or ciphertext lengths from database readers.

For Chunk IDs, xxHash64 is a public, non-cryptographic prehash. Distinct Chunk
texts which produce the same 64-bit prehash produce the same ID under the same
saved key. The final 256-bit HMAC does not restore distinctions lost at that
stage, so collision resistance for Chunk IDs is bounded by xxHash64 rather than
by the HMAC output width. This limit is an accepted trade-off for bounding the
content processed by HMAC.

The independent ID key preserves existing file contents, Chunk representation,
and `_rev` behaviour. It does not change the privacy properties of those
formats. Payload and virtual file padding remain outside this change.

## Sharing, import, and storage

Include the saved derived value and its version in Setup URIs, protected by the
existing, separate Setup URI passphrase. Import the saved value directly.
Additional devices therefore need neither the original source nor another
derivation step. Manual setup can reproduce it by entering the same source and
version, or by importing the tagged recovery code. After an E2EE passphrase
change, the current passphrase cannot be assumed to reproduce the old ID secret.

The standalone Setup URI generator uses a fresh random 256-bit ID key by
default, prints its tagged recovery code, and accepts that code for repeatable
generation for the same Vault. `id_mode=legacy` selects the old ID behaviour.
Running it again without the code produces a different key, so the generated
URI must not be treated as an update for an existing remote.

QR sharing includes the same fields through the existing QR representation and
warnings. Its current payload is not encrypted like a Setup URI. The agreed
scope accepts that existing sharing model and user responsibility for keeping
QR material private; it adds no QR storage or expiry mechanism.

| Boundary                                                    | Required handling                                                                                                                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing settings and old complete Setup URI/QR/P2P imports | Missing fields select legacy behaviour. Do not inherit an unrelated value already present on the receiving device.                                                      |
| Ordinary partial setting updates                            | Preserve the current secret and version when neither is supplied.                                                                                                       |
| New-format imports                                          | Validate version and value together before applying or starting database work.                                                                                          |
| Local persistence                                           | Integrate the secret explicitly with sensitive-configuration encryption and loading. Adding an arbitrary field does not currently provide this protection.              |
| Reports, logs, and Markdown settings                        | Redact the secret in reports and logs; treat it as a credential in the existing Markdown export/import policy. An export which omits credentials must omit this secret. |
| Remote profiles, CLI, WebApp, WebPeer, and direct writers   | Carry the effective value and version through every supported configuration path. A selected new mode must never degrade silently to legacy mode.                       |

Setup URI JSON encoding can carry ordinary new settings, but QR encoding uses
an explicit key-index table. Append stable QR entries without reordering old
ones. Complete imports and partial edits must have distinct missing-value
semantics even where the current implementation merges settings objects.
In particular, `SetupManager` currently merges decoded URI settings over the
receiving device's settings. Complete imports must normalise the new fields
before that merge to prevent accidental inheritance.

## Compatibility and changes to existing data

| Difference or change                                                      | Consequence                                                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Different Chunk derivation only                                           | Existing content remains readable through Metadata `children`; new writes can duplicate Chunks and reduce reuse.                |
| Different obfuscated document ID derivation                               | The same path can become separate documents. Treat this as an incompatible configuration requiring resolution.                  |
| New E2EE passphrase, unchanged saved ID secret                            | IDs remain stable for unchanged content, paths, and other ID settings. Re-encryption still requires the existing E2EE workflow. |
| Enabling, replacing, or disabling the option with Path Obfuscation active | Document identity changes. Use the established authoritative Rebuild and secondary-device Fetch workflow.                       |
| Existing installation with no new option                                  | Preserve its exact legacy behaviour; do not derive or copy a value during upgrade.                                              |

Copying the legacy passphrase into the new derivation does not preserve legacy
IDs, because the derivation itself changes. This proposal therefore makes no
automatic or seamless migration promise. Before an explicit transition, update
and stop the participating devices, select the authoritative data, and use the
existing [Rebuild and Fetch procedures](../recovery.md). Share the resulting
configuration before other devices rejoin. One-entry
[Metadata ID repair](metadata_document_id_validation_and_repair.md) does not
perform this transition.

Commonlib's Chunk cache includes content-to-ID lookup before hashing. Changing
the hash function alone can keep producing old IDs, and reading old Chunks can
populate that lookup again. The implementation must distinguish read reuse
from the ID selected for a new write, including after manager replacement and
restart. Readers continue accepting referenced legacy Chunks.

## Agreement checks and older clients

Keep checks focused on preventing incompatible document identities. Reuse the
existing configuration review and replication admission paths. A mismatch
must not be treated as an automatically alignable Chunk setting when document
IDs depend on it. Show a mismatch or unsupported version without exposing the
saved secret.

The advertised ID version is used for comparison only. Ordinary Tweak alignment
preserves each device's ID version and key together, including when only Chunk
IDs differ. A document ID mode mismatch requires explicit configuration through
a Setup URI or the matching key, rather than adopting a version without its key.

For CouchDB, extend the supported feature set in the remote feature contract
introduced by PR #1222, then declare the new requirement before writing data
under it. That mechanism rejects unsupported features at admission and provides
a best-effort stop when an unsupported requirement arrives later. It checks
format support, not equality of saved secrets, and does not make a live
migration atomic. Journal can extend its existing milestone compatibility path;
P2P needs its separate admission handling. The CouchDB feature contract alone
cannot protect those transports.

The implementation checks up to two remote documents in each ordinary and
internal obfuscated-ID namespace before CouchDB replication or direct writes.
This includes a legacy-mode caller connecting to a remote which uses keyed IDs.
For each available sample it recomputes the ID from the decrypted path; any
mismatch rejects the connection. An empty database, or one with no usable
sample, is reported as unverified and may proceed because there is no observed
document identity to conflict with. A sampled match is evidence, not a proof
that every document has the same identity; an unsampled mixture remains a
limitation of this bounded check.

When E2EE and Path Obfuscation are both active, Journal stores an
E2EE-encrypted, domain-separated proof in its existing milestone. It is
encrypted before the milestone is uploaded and compared on later connections.
An established milestone without this proof requires a Rebuild before the new
document IDs can be used. Journal advertises a new compatibility range for
keyed document IDs so older clients reject it. P2P compares a
purpose-separated HMAC over a fresh challenge during peer admission; the proof
is not stored. When Path Obfuscation is off, different keys affect only Chunk
IDs, so Journal keeps its legacy compatibility range and P2P does not require
key agreement. Neither transport publishes the key or a plaintext verifier in
Tweak values. CouchDB and direct writers use the document sample check above
rather than a stored verifier. The sample check uses the host's path service
with the attempted settings snapshot so stored non-canonical paths are treated
the same way as ID generation.
The existing `_rev` behaviour for ordinary content remains unchanged.

## Implementation responsibilities

The following are the confirmed integration points in the reviewed baseline.
Commonlib paths refer to its package implementation, not a source mirror in
this repository.

| Owner and entry points                                                                                         | Work                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commonlib `HashManagerCore`, concrete hash managers, `PathService`, and `path2id_base`                         | Select legacy or new derivation consistently; preserve path and namespace semantics.                                                                              |
| Commonlib `EntryManagerImpls`, `LayeredChunkManager`, and `LiveSyncManagers`                                   | Keep referenced Chunks readable and invalidate or partition generation-dependent caches.                                                                          |
| Commonlib settings definitions/lifecycle, `SettingService`, `pickEncryptionSettings`, and `API/processSetting` | Own version validation, persistence, copying, imports, Setup URI encoding, and QR slots.                                                                          |
| Commonlib compatibility assessment and replication implementations                                             | Classify identity differences, protect any comparison data, and enforce supported formats at each transport boundary.                                             |
| Commonlib `API/DirectFileManipulatorV2`                                                                        | Carry the option through its explicit settings and path-obfuscation configuration.                                                                                |
| LiveSync `SetupRemoteE2EE.svelte`, `PaneRemoteConfig.ts`, and `SetupManager.ts`                                | Implement the three configuration actions and three nested ID-key inputs, configured state, local recovery-code reveal, and existing Apply/Rebuild/Fetch choices. |
| LiveSync `replicatorConfigurationIdentity.ts`, `reportTool.ts`, and `ModuleObsidianSettingAsMarkdown.ts`       | Replace connections when effective settings change, redact the secret, and apply credential-sharing rules.                                                        |
| CLI, browser applications, and setup tools                                                                     | Use the same Commonlib contract in manual setup and imports; generate new Setup URIs with a reusable random ID key by default.                                    |

Implement Commonlib changes in its own repository, validate its packed artefact,
and validate LiveSync against that exact dependency before adopting a released
version. Translations remain outside this implementation scope.

## Validation

The fixed-vector and cache tests first failed against unchanged Commonlib
`0.1.32`, then passed after the implementation change. Commonlib's 2,036 Unit
tests, type check, package boundary, and isolated packed-package checks pass.
Three Integration tests against real CouchDB and Object Storage verify direct
access, Journal agreement, and rejection before control-document changes.
The same-manager E2EE-off regression was reproduced and fixed.

LiveSync's 1,049 Unit tests, type and lint checks, production build, and iOS 15
bundle syntax check pass after installing the exact published `0.1.33`
package. Its tarball matches the validated publication candidate, and all 559
installed package files match the registry artefact. The resulting bundle is
identical to the one checked before publication.

Real Obsidian two-Vault checks with the accepted Chunk construction cover
matching-key synchronisation, incompatible document key rejection, and
differing Chunk keys with visible paths. The Review Harness also passes with
the published package, verifying actual ID calculations and report copying
without changing live settings. Its adapter imports `HashManager` through
Commonlib's focused `/hashing` entry, whose package checks cover public types,
Node execution, and browser bundling.

### Current Chunk calculation performance

The actual Commonlib `HashManager` implementations were compared in Obsidian
1.12.7 on ARM64 Linux. Six samples rotate all three variants through each
execution position twice. The table reports median total ID calculation time;
1,000 means the total for 1,000 IDs, not the time per ID. Inputs are synthetic.

| Input                             | IDs per sample | Legacy xxHash64 | Previous independent HMAC | Updated independent ID |
| --------------------------------- | -------------: | --------------: | ------------------------: | ---------------------: |
| 256-byte text                     |          1,000 |         4.50 ms |                  41.40 ms |               24.45 ms |
| 4 KiB text                        |          1,000 |        10.00 ms |                  96.25 ms |               29.70 ms |
| 32 KiB text                       |          1,000 |        48.40 ms |                 494.40 ms |               68.95 ms |
| 10 MiB binary, default splitting  |            103 |        19.60 ms |                 192.50 ms |               21.45 ms |
| 50 MiB binary, default splitting  |            512 |        99.85 ms |                 972.75 ms |              106.65 ms |
| 10 MiB binary, Self-hosted preset |              5 |        24.10 ms |                 216.90 ms |               18.50 ms |
| 50 MiB binary, Self-hosted preset |             35 |       118.40 ms |               1,067.00 ms |               91.75 ms |

The first updated ID, including Chunk-key preparation, took 1.3 ms in this
run. Repeated measurements exclude preparation, warm-up, and pauses. Binary
cases use the actual splitter and Base64 representation; all decoded bytes
and repeated IDs were checked. Splitting, Base64 conversion, database work,
payload encryption, and transfer are outside the measured interval. These
results establish lower ID calculation cost on this host, not a complete
Rebuild speedup or native mobile performance.

### Native-device ID measurements

User-supplied Review Harness reports compare the previous and updated builds
on Android 13 and iOS 18.7. Each value is the median total time for 1,000
independent Chunk IDs, using three samples in each run.

| Input         | Android, previous | Android, updated | iOS, previous | iOS, updated |
| ------------- | ----------------: | ---------------: | ------------: | -----------: |
| 256-byte text |           53.6 ms |          37.8 ms |         21 ms |        20 ms |
| 4 KiB text    |           70.9 ms |          43.4 ms |         22 ms |        22 ms |
| 32 KiB text   |          151.1 ms |          66.5 ms |         36 ms |        39 ms |

Android's 32-KiB result takes about 56% less time. The corresponding iOS
result increases by 3 ms per 1,000 IDs; separate runs with three samples do
not establish the cause of that difference. Across these sizes, the updated
independent calculation adds approximately 18–25 ms per 1,000 IDs over each
device's legacy xxHash64 calculation. Save-time key derivation has medians of
46.6 ms on Android and 51 ms on iOS.

These reports measure synthetic ID calculations, excluding database work,
payload encryption, and transfer. Android's heap samples remain constant,
and iOS does not expose them, so the reports do not establish memory usage or
improvement. The updated build has not been measured on Windows.

The checks below are historical reference evidence for the predecessor
independent-ID implementation, which used full-content HMAC-SHA-256 for Chunk
IDs. They do not validate the current xxHash64-prehash construction.

### Historical predecessor checks

Earlier consumer validation used a local Commonlib `0.1.32` candidate. Clean
installations with npm 10 and npm 11, type checking, lint, Svelte checks, the
production build, and the iOS 15 bundle compatibility check passed. LiveSync
had 1,039 passing Unit tests, six passing Integration tests against real
CouchDB, and seven passing Setup URI utility tests with the frozen Deno
lockfile.

Predecessor Commonlib candidate checks covered deterministic vectors, Unicode
normalisation, legacy behaviour, encrypted settings persistence, imports,
cache transitions, and transport admission. Its Integration tests against real
Object Storage accept a matching Journal key, reject a different document ID
key before changing the milestone, and allow different Chunk keys when paths
remain visible. A direct-access Integration test against real CouchDB reads
with the same key and rejects a different key before changing the version
document. These library tests complemented the consumer checks for that
predecessor; they were not additional LiveSync Unit tests.

Real Obsidian 1.12.7 on ARM64 Linux verifies the following consumer boundaries:

| Boundary                 | Verified behaviour                                                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CouchDB synchronisation  | Two Vaults exchange notes in both directions with matching document and Chunk IDs. Different Chunk keys also work with Path Obfuscation off.                                                                         |
| CouchDB rejection        | Ordinary replication rejects different or legacy document ID keys before downloading files or changing remote documents and checkpoints.                                                                             |
| Visible onboarding       | Both a separate source and the random default persist an encrypted key, transfer it through a Setup URI, complete Fast Fetch, and synchronise in both directions. The `%`-prefixed E2EE passphrase survives restart. |
| Input and recovery       | The radio controls and disabled styling are exercised. An empty first source keeps the dialogue open with an error; empty input keeps an existing key. A recovery code restores the same key.                        |
| Journal upload           | The uploaded documents and Chunks have keyed IDs, and the first Object Storage milestone contains the encrypted agreement proof.                                                                                     |
| Credential-free Markdown | Neither the saved ID key nor its encrypted representation appears in exported settings Markdown.                                                                                                                     |

A CLI P2P E2E run with a local relay imports encrypted Setup URIs, transfers a
note with matching keys, and rejects a peer with a different document ID key.
A separate check loads the published `0.1.31` DirectFileManipulator in another
process: it reads a legacy remote, and rejects an independent-ID remote with
or without Path Obfuscation, leaving remote documents and checkpoints
unchanged. This checks the previous library API, rather than an older
Obsidian installation. Bounded sampling tests cover empty and mixed document
collections; they do not establish that every document in a remote is
compatible.

### Performance reference for the predecessor

The measurements below are historical results for a local predecessor
Commonlib `0.1.32` candidate which used full-content HMAC-SHA-256 for
independent Chunk IDs. They are reference evidence only, not performance
results for the accepted xxHash64-prehash construction. Both modes enable E2EE
and Path Obfuscation; the legacy baseline uses `xxhash64`. Three trials per
mode alternate their order. These are synthetic corpora and serial local
writes, excluding Vault enumeration, remote payload encryption, and transfer;
they are not timings of the complete Rebuild action.

Saving an ordinary ID source takes 52–57 ms in Node.js 24, with a median of
56 ms. This PBKDF2 operation happens once when saving the source. Per-Chunk
and per-document IDs use the saved key and do not repeat PBKDF2.

The actual Obsidian renderer gives these median times for 1,000 serial calls
to the Commonlib hash manager or Path Service, after warm-up:

| Input                    |  Legacy | Independent ID |
| ------------------------ | ------: | -------------: |
| Distinct 256-byte Chunks |  5.4 ms |        43.3 ms |
| Distinct 4 KiB Chunks    | 15.0 ms |       104.8 ms |
| Distinct 32 KiB Chunks   | 52.8 ms |       581.7 ms |
| Distinct document paths  | 36.5 ms |        50.0 ms |

These direct calls include no Chunk-content cache hits. The predecessor hash
had a measurable cost, especially when there were many small Chunks. The
local-write experiments exercise splitting, ID generation, Chunk reuse, and
PouchDB writes:

| Workload and adapter                                          | Legacy median (range) | Independent median (range) |
| ------------------------------------------------------------- | --------------------: | -------------------------: |
| 5,000 text/binary files, 100 MiB, Node PouchDB memory adapter |  102.6 s (87.4–109.3) |         86.6 s (75.4–93.1) |
| 1,000 text files, 19.5 MiB, actual Obsidian local database    |    78.7 s (52.0–82.8) |         63.2 s (62.8–63.8) |

The measurements do not show a large overall slowdown for these workloads,
but the variation does not support a general speedup claim. Both experiments
checked document counts, Chunk-reference counts, and sample content readback.
The Node experiment also checked that every referenced Chunk was present. The
100 MiB corpus includes 250 duplicate files and produces 213,788 Chunk
references to 199,468 distinct Chunks in both modes, preserving reuse.

For that corpus, stored document JSON grows from 133,157,581 to 154,342,743
UTF-8 bytes, an increase of 15.9%. The text-only Obsidian corpus produces many
small Chunks and grows from 27,893,656 to 33,594,994 bytes, or 20.4%, including
32 warm-up documents. Longer Chunk IDs occur in both Chunk documents and
Metadata references. Ordinary obfuscated document IDs remain 66 characters.
These totals measure serialised document JSON; physical database and index
growth depend on the adapter and have not been measured.

### Remaining validation

Larger binary workloads on mobile, a representative user's Vault, physical
storage growth, and the complete Rebuild wall time remain unmeasured. The
native-device reports above verify the synthetic ID calculation scenario;
desktop E2E and mobile viewport checks do not establish other mobile
operating-system behaviour. URI revocation, QR redesign, and automatic
migration remain outside this change.
