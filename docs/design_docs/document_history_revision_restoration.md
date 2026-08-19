# Document History Revision Restoration

## Status

Accepted for a limited implementation.

## Problem and scope

Document History can reconstruct an available historical revision from its
Chunks and write that content to the Vault through **Back to this revision**.
The current action writes directly through the storage adapter. It does not
create a new Metadata revision, clear a logical deletion through a successor,
or record which database revision produced the restored Vault file.

This leaves a logically deleted Metadata document at `deleted: true` after the
file has returned to the Vault. A later ordinary Vault save may create a live
successor, but restoration must not depend on an unrelated later file event.

The same action does not inspect or preserve revision-tree intent explicitly
when conflicts exist. Document History currently displays the ancestry of the
PouchDB winner. It does not display the complete revision tree or the ancestry
of every conflict leaf.

This design covers restoration of one readable historical revision of a normal
Vault file. It creates a new live revision, reflects that exact revision to the
Vault, and leaves every other live conflict branch available for the existing
conflict workflow.

## Evidence

A real-Obsidian exercise created a Markdown document, removed it through the
Vault API, and waited for LiveSync to store a logical-deletion successor. The
Metadata retained all referenced Chunks, and Document History could reconstruct
the deleted content.

Selecting **Back to this revision** restored the file and its exact bytes to the
Vault. The local database nevertheless retained the same deleted current
revision after file processing had settled. An additional ordinary Vault save
then created a new non-deleted successor. This demonstrates that content
reconstruction works and that the missing operation is the database-aware
restoration step.

## Revision-tree decision

The selected historical revision is the content source. It is not necessarily
a live leaf and is not used as the parent of the new write.

At the time of the restoration operation, LiveSync reads the current PouchDB
winner. The new revision is written as a child of that exact live revision and
contains the selected historical content with no logical-deletion marker.

For an unconflicted logical deletion:

```text
A -- D (deleted winner) -- R (restored live successor)
```

For an existing conflict:

```text
A -- W (winner) -- R (restored successor)
 \
  C (existing conflict remains live)
```

Advancing the winner branch is the ordinary meaning of reverting its content.
The previous winner remains in revision history, while every other live leaf
remains available for conflict resolution. Restoration does not manufacture an
additional independent branch merely to retain the previous winner as another
live conflict.

The existing **Inspect conflicts and file/database differences** workflow owns
subsequent comparison and resolution of the restored revision and the remaining
live leaves. Document History supplies content which may no longer be a live
leaf; the Inspector operates on the live tree after that content has been
restored. Neither interface replaces the other.

## Persistence and reflection order

Restoration performs these steps in order:

1. read and reconstruct the exact selected historical revision;
2. read the current winner and use its exact revision as the write base;
3. create Chunks and conditionally write a new non-deleted Metadata revision
   containing the selected content below that live base;
4. obtain the exact created revision from the database write;
5. reflect that exact revision to the Vault; and
6. record the reflected revision as the device-local file provenance.

The database write precedes Vault reflection. If the database write fails, the
Vault remains unchanged. If the new revision is stored but Vault reflection
fails, the live restored revision remains recoverable and the operation reports
that the database restoration completed without successful reflection. It does
not remove the new revision in an attempted rollback.

The new Metadata keeps the current document's creation time, records the
restoration as a new modification, and derives its size and type from the
reconstructed bytes. Reusing the historical modification time would make an
explicit present-day restoration appear older than concurrent changes and
would interact poorly with modification-time policies.

## Conflicts and concurrent changes

Existing conflict leaves are never deleted by restoration. When conflicts
remain after the new revision is written, LiveSync keeps the ordinary conflict
indicator and conflict-resolution workflow available. The interface explains
that restoration advances the currently shown branch and does not resolve the
other versions.

Document History does not perform a separate comparison with the winner which
was current when the dialogue opened. The conditional exact-base write uses an
ordinary PouchDB new edit. If that base is no longer a writable live leaf,
PouchDB rejects the write and the dialogue reports that the revision tree
changed and the operation should be retried. If the base remains live while
another conflict leaf appears, the write may succeed and both branches remain
available.

Commonlib's existing `storeWithBaseRevision` operation cannot provide this
condition. Its force-write behaviour intentionally uses `new_edits: false` so
that conflict-preservation workflows can create a branch from a supplied
ancestor. The restoration path therefore uses a separate
`storeWithLiveBaseRevision` operation. That operation writes below the supplied
leaf with ordinary PouchDB revision checking and never falls back to the force
path.

The action must not silently fall back to an unbased write after an exact-base
failure.

## History presentation boundary

The current slider continues to represent the available ancestry of the
PouchDB winner. Building a complete branch-aware history viewer would require
loading the ancestry of every live leaf, joining shared ancestors, representing
missing or compacted revisions, and adding an explicit branch-selection
interface. That work is not required to restore the history currently shown.

When the document has conflicts, the dialogue may state that restoration will
create a new revision on the winner branch which is current when the action
runs, and leave the other versions unresolved. Detailed branch comparison
remains in the Inspector.

## Ownership

LiveSync owns:

- selection and reconstruction of the historical revision;
- the Document History user interaction and result messages;
- orchestration of the exact-base write and exact-revision reflection; and
- presentation of any remaining conflict state.

Commonlib owns:

- Chunk creation and Metadata persistence;
- `storeWithLiveBaseRevision`, which writes content as a normal child of an
  exact live revision and returns the created revision;
- rejecting an unavailable or stale base revision;
- reflecting an exact live revision to storage; and
- recording device-local file-reflection provenance.

The implementation retains `storeWithBaseRevision` for the conflict workflows
which deliberately create branches. The new conditional operation is narrower
and is not a replacement for that existing behaviour.

## Non-goals

This change does not:

- identify the origin of malformed or doubled Metadata paths;
- turn Document History into a complete revision-tree viewer;
- select, merge, or discard existing conflict leaves;
- restore unavailable content whose Chunks cannot be reconstructed;
- mutate an old revision or clear its deletion marker in place;
- rebuild a local or remote database; or
- change automatic conflict-resolution policy.

## Verification

Focused tests cover:

- restoring readable content as a non-deleted child of a deleted winner;
- returning and reflecting the exact created revision;
- retaining every existing conflict leaf while advancing the winner branch;
- refusing an exact-base write when the base is no longer live;
- retaining the existing force-write behaviour for callers which deliberately
  create a conflict branch;
- leaving the Vault unchanged when database persistence fails; and
- retaining the stored live revision when subsequent Vault reflection fails.

The real-Obsidian regression exercise removes the additional normal Vault save
from the earlier reproduction. **Back to this revision** must itself produce a
new live database revision, restore the exact content to the Vault, and reopen
Document History at that successor.
