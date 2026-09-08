---
date: 2026-09-08
commonlib-version: "0.1.24"
self-hosted-livesync-version: "1.0.27"
status: unreleased
---

# Tweak compatibility and recovery

This document describes the integration of Commonlib 0.1.24 with
Self-hosted LiveSync 1.0.27. Commonlib owns the interpretation of synchronisation
settings; LiveSync owns the dialogues and operations which consume that result.

## Shared assessment

`assessTweakCompatibility`, exported by Commonlib's `settings` entry point,
compares one snapshot of current settings with one snapshot of preferred settings.
The result contains the original values, effective values, differences, and
reconstruction consequences for each direction of adoption. It performs no
settings writes, translation, network requests, or database operations.

The interpretation of a missing value is specific to its setting. A missing
`handleFilenameCaseSensitive` means `false`, matching legacy conversion from paths to
document IDs. An explicitly enabled value is therefore different from either an
explicitly disabled value or a missing value. Settings whose historical missing
value has not been established remain unadvertised; the evaluator does not
invent defaults or turn every falsy value into an absent value.

The central replication gate, mismatch dialogues, and RedFlag Fetch preparation
consume the same effective differences. The P2P transport retains its separate
policy: ordinary representation differences warn without rejecting transfer,
while its existing passphrase and peer checks still apply. Sharing assessment
does not make the central replication policy appropriate for every transport.

## Host responsibilities

`ModuleResolvingMismatchedTweaks` renders the assessment supplied by the failed
attempt. A legacy recovery hint without an assessment is adapted through the
same Commonlib function. The remote profile review uses the trial settings as
its current snapshot, including when deciding whether compatible chunk settings
can be accepted automatically.

Each adoption direction has its own reconstruction consequence. The remote
values becoming local values can require local Fetch; the local values becoming
preferred remote values can require remote Rebuild. The host must not infer the
second consequence from the first. Existing explicit Fetch choices and manual
acceptance controls remain host decisions.

The common assessment identifies whether every known difference qualifies for
automatic alignment. LiveSync retains the opt-out and modification-time policy
which chooses a side. An unadvertised setting does not expand automatic
alignment to a case whose effect cannot be assessed.

Only defined, permitted settings are applied. A partial preferred configuration
must not erase a local value with `undefined`. Recommended settings outside the
set of settings which must match retain their existing adoption behaviour; RedFlag Fetch
continues to apply only the set of settings which must match. RedFlag Rebuild remains
authoritative from this device and does not adopt the remote configuration.

## Decision lifetime

An assessment describes one pair of inputs; it does not authorise a later
write. LiveSync checks the settings and active publication again after waiting
for a decision and before applying it. A changed target or changed settings
discard that decision. The signature used for this check can contain sensitive
configuration and must not be logged, persisted, or included in diagnostics.

The active publication reservation is not held while waiting for the dialogue.
Remote writes use the failed attempt's publication guard. Fetch and Rebuild use
their existing owners and propagate failure without claiming a successful
retry. A subsequent attempt must use fresh settings and respect publication
replacement rather than reusing the rejected attempt's settings snapshot.

Ordinary typed OneShot replication retains the failed outcome after its recovery
dialogue; the next synchronisation request is a separate attempt. Directional
replication can retry once after `CHECKAGAIN`, using freshly captured settings
and the same publication guard. Setting adoption does not turn the original
failed transfer into a completed transfer.

## Verification boundaries

Commonlib tests protect missing-value interpretation, representation differences,
directional consequences, immutable results, central admission, and P2P policy.
LiveSync unit tests protect ordinary versus reconstruction choices, trial-setting
selection, partial-setting adoption, and invalidated decisions. RedFlag tests
protect the distinction between adopting settings for Fetch and retaining local
settings for Rebuild.

Real-runtime verification must separately cover setting adoption, actual
replication, explicit Fetch, and replication after restart. A unit test which
mocks Fetch does not establish those behaviours, and a corrected mismatch
dialogue alone does not establish the cause of a reported persistent automatic
synchronisation failure.
