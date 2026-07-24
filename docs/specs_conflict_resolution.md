# Conflict resolution and revision provenance

This document describes the conflict-resolution and file-reflection guarantees used by Self-hosted LiveSync 1.0, together with the cases which still require user judgement. The underlying revision-tree operations and injectable provenance contract are owned by `@vrtmrz/livesync-commonlib`; LiveSync owns persistent device-local composition, Vault reflection, settings, and dialogue policy.

## Revision-tree model

PouchDB stores a document as a revision tree. It selects one live leaf as the deterministic winner and reports the other live leaves as conflicts. That winner is not proof that its content is newer, safer, or the version currently shown in the Vault.

For example:

```text
A1
├── B1 ── C1 ── D1
└── B2 ── C2
```

The two live leaves are `D1` and `C2`. Their nearest shared ancestor is `A1`; neither `B1` nor `B2` is shared. A conservative three-way merge therefore compares the changes from `A1` to each leaf. Matching generation numbers, or selecting the first older revision from one branch, does not prove shared ancestry.

Resolving a conflict writes the selected or merged result on one observed branch and deletes the other observed live leaf. A stale device may still have the deleted leaf's content in its Vault when it receives the resolution.

## Implemented 1.0 guarantees

- Automatic text and structured-data merge uses the nearest `available` revision ID which is present in both leaf histories.
- Missing or compacted history stops conservative automatic merge instead of guessing a base.
- A receiving Vault file which exactly matches any available revision in the document tree is treated as previously synchronised content. This includes an ancestor below a deleted losing leaf.
- A receiving Vault file whose bytes do not match any available revision is preserved as an unsynchronised local change.
- File bytes, rather than path, size, modification time, or revision generation, determine whether content is known.
- Three or more live versions are reviewed one pair at a time in a deterministic order, with each completed pair committed before the next live pair is read.
- Each device records the exact revision most recently reflected in each Vault file. An edit, deletion, or case-only rename made while a conflict is active extends that displayed branch rather than the deterministic database winner.
- A cross-path rename stores the target before logically deleting only the displayed source branch.

The all-branch history check prevents a resolved conflict from being recreated merely because the receiving Vault still contains the known losing version. If the user has edited that version again, its bytes differ and the overwrite guard preserves it.

## Resolution patterns

| State                                                                            | Safe action                                                       |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Both leaves contain identical bytes                                              | Collapse the duplicate leaf.                                      |
| Text or structured data has an available shared base and non-overlapping changes | Perform a conservative three-way merge.                           |
| One side deletes content which the other leaves unchanged                        | Preserve the deletion.                                            |
| One side deletes content which the other modifies                                | Ask the user.                                                     |
| A receiving file matches a revision available anywhere in the tree               | Apply the propagated database result.                             |
| A receiving file matches no available revision                                   | Preserve it and ask the user.                                     |
| A required body or shared ancestor is missing or compacted                       | Ask the user.                                                     |
| Binary contents differ                                                           | Prefer an explicit user selection; semantic merge is unavailable. |

The compatibility implementation currently selects the newer modification time for differing binary conflicts even when the general **Always overwrite with a newer file** option is disabled. This is existing behaviour, not a new 1.0 guarantee. Changing it to explicit selection only is a separate compatibility decision.

## Unreadable revisions and repair

A document revision can remain in the PouchDB tree while one or more chunks needed to reconstruct its content are unavailable. Missing content is not evidence that the revision is obsolete. LiveSync therefore leaves an unreadable winner or conflict revision in the tree instead of deleting it during automatic conflict processing.

**Hatch** → **Verify and repair all files** inspects the current winner, every current conflict revision, and the nearest shared ancestor for each conflict. It reports exact revision identifiers and local chunk availability separately:

- **Retry reading revision** attempts the configured chunk-retrieval path again. It does not change the revision tree.
- **Discard unreadable revision** is available only for a current winner or conflict revision which remains unreadable when the action is performed. It requires confirmation and creates a logical deletion for that exact revision.
- A shared ancestor is informational. An ancestor which is no longer a live revision cannot be discarded independently through this workflow. If its body is unavailable, conservative three-way merge remains disabled, although readable live revisions can still be selected manually.

Logical deletion does not recreate missing bytes, purge the document history, or prove that the deleted version was unimportant. Another replica or backup may still contain the missing chunks. Recover from that source before discarding a revision whenever possible.

**Recreate chunks for current Vault files** can recreate chunks only from files which are readable in the current Vault. It cannot reconstruct unique bytes from an unavailable historical or conflict revision.

Garbage Collection V3 treats every live conflict revision and its nearest available shared ancestor as reachable. Their locally available chunks are retained until the conflict is resolved. After resolution, chunks used only by the discarded branch or no-longer-needed merge ancestry can become eligible for collection. See the [Garbage Collection V3 specification](specs_garbage_collection.md).

A generation-one revision has no parent. When its body is unavailable, LiveSync cannot preserve a changed Vault file as a sibling branch without inventing ancestry. It leaves the operation unresolved. Recover the missing chunks from another replica or backup, or explicitly discard that live revision. If the current Vault file is the intended replacement, it can be stored after the unreadable revision has been logically deleted.

### Two devices independently create the same path

If two devices create the same full synchronised path before either device has
received the other creation, the two generation-one leaves have no shared
revision. Files with the same name in different directories remain separate
paths and do not form this conflict.

When the independently created files contain identical bytes, LiveSync deletes
one duplicate leaf without synthesising merged content. A device which still
records the deleted duplicate as its displayed revision already has the same
bytes as the surviving revision, so it does not recreate the conflict. It
rebinds its device-local provenance to the surviving revision.

When the independently created files contain different bytes, conservative
three-way merge has no valid base. LiveSync therefore leaves the two versions
for manual selection; it does not guess an empty base or concatenate unrelated
files. If both versions instead descend from a revision which the devices had
previously synchronised, they are ordinary divergent branches: LiveSync may
merge non-overlapping text or structured-data changes from that shared base,
and otherwise asks the user.

## Stale and concurrent resolutions

A device can resolve only the leaves which it has observed. If another device has already extended a branch, later replication can reveal another live leaf and require another resolution. Two devices can also produce different resolutions concurrently, leaving multiple live leaves after their trees meet.

A higher revision generation or modification time does not make either result authoritative. The resolver must examine every current live leaf again until one result remains or user action is required. This is continued conflict processing, not a reset of the synchronisation checkpoint.

## More than two live versions

When three or more versions remain, LiveSync compares the current PouchDB winner with one conflict leaf at a time. Commonlib orders the remaining candidates by revision generation ascending, original leaf modification time ascending, then the complete revision ID in code-unit lexical order. A missing or non-finite modification time is ordered before a finite value. Modification time makes pair selection reproducible here; it does not decide which content wins.

For each pair, LiveSync first collapses identical content, then attempts a conservative sensible merge, and finally asks the user when neither automatic action is safe. A completed action is written to the ordinary revision tree and its losing observed leaf is deleted before LiveSync reads the remaining live leaves again. There is no separate persistent merge accumulator.

**Concat both** writes the concatenated result as a new child of the displayed PouchDB winner, then deletes only the other leaf shown in that dialogue. With two live versions, that action resolves the conflict. With three or more, the new child remains live against every untouched leaf and becomes part of the next pairwise review; it does not create an unrelated root or consume an unseen branch.

Consequently, choosing **Not now** or closing Obsidian cannot undo a completed pair. After restart, LiveSync reconstructs the next pair from the live tree. If replication changes either revision while a dialogue is open, LiveSync discards the stale selection, refreshes the live count, and rechecks the path rather than deleting a revision which was not the one shown.

## Device-local file provenance

LiveSync composes Commonlib's injected `FileReflectionProvenance` with its local key-value database. Each device stores:

```text
path -> { revision, observedStorageMtime? }
```

`revision` identifies the exact database revision which most recently produced the displayed Vault file. `observedStorageMtime` is the raw local modification time observed after reflection. It is not rounded, combined with another device's value, or used as proof of branch identity. No content hash is persisted.

The record changes only after a successful database-to-Vault reflection or Vault-to-database write. Reading a file does not change it. The recorded revision remains authoritative even if the user edits the file to bytes which equal another branch; otherwise content equality could silently move the edit to a branch which was not displayed.

LiveSync creates the namespaced store handle during service composition, before the key-value database is open. The sequential `onSettingLoaded` lifecycle opens that database before Vault scanning, watching, or replication starts. Store operations do not wait for implicit readiness: a lifecycle violation fails promptly, avoiding an indefinite or self-referential initialisation wait. Local database reset is a transient unavailable boundary, after which scanning reconstructs derived state.

When no record exists, LiveSync may reconstruct the displayed revision only if the current Vault bytes match exactly one available revision body. No match, or identical content in multiple revisions, cannot prove branch identity.

## Operations while a conflict exists

- Editing a file writes a child of its recorded or uniquely reconstructed displayed revision.
- Deleting a file writes a logical-deletion child of that revision. It uses LiveSync's `deleted` marker, rather than a PouchDB `_deleted` tombstone, so the deletion remains a live branch which can replicate and be resolved against the other branch.
- A case-only rename writes the new path as a child in the same document tree.
- A cross-path rename stores the target document first, then writes a logical-deletion child on the displayed source branch.

If an edit's base cannot be proved, LiveSync keeps the bytes as another manual-resolution branch instead of attaching them silently to the database winner. If a deletion's displayed branch cannot be proved after the file body has gone, LiveSync preserves every branch and requests conflict review. For an unproven cross-path rename, the new target remains stored and every source branch is preserved for review. These fallbacks can leave a temporary duplicate or unresolved source, but they do not discard an unproven branch.

## Interactive dialogue policy

Choosing **Not now** postpones repeated merge dialogues for the same
uninterrupted conflict episode in the current plug-in session. Ordinary file
checks and replication do not reopen the dialogue while at least one conflict
leaf remains. If the in-editor status display is enabled, the active file shows
**This file has 3 unresolved versions. They will be reviewed one pair at a
time.** for three or more live versions, using the current count, and **This
file has unresolved conflicts.** for two. Postponement therefore does not make
the conflict invisible.

The command **Resolve if conflicted.**, and selecting a file through **Pick a
file to resolve conflict**, explicitly clear the postponement and request the
dialogue again. Cancellation caused by another conflict dialogue does not count
as **Not now**. Once the document has no remaining conflicts, the episode ends;
a later conflict at the same path prompts normally. The postponement is not
persisted across a plug-in reload. Completed pairwise resolutions are persisted
in the ordinary revision tree, so a reload forgets only the postponement and
does not repeat an already committed stage.

When synchronisation supplies a resolved document, the existing incoming-file
processing event closes an open conflict dialogue for that path. The same event
rechecks the local revision tree: if no conflict leaf remains, it ends any
postponed episode and removes the active-file warning. If conflict leaves still
exist, the stale dialogue closes and the warning changes to the current live
version count. A postponed episode stays postponed; otherwise, subsequent
conflict processing may open a fresh dialogue for the current revision tree.
Each dialogue owns its completion result, so a prompt which is answered or
closed immediately still completes the waiting conflict operation; the result
does not depend on a later global listener being ready.
The end of an automatic repeat is silent. An explicit **Pick a file to resolve
conflict** request which starts with no conflicts may show one confirmation
Notice.

## Example device scenarios

### A user edits the branch shown on one device

Mac and Android have produced two branches of `shared.md`. Mac's local database selects revision `C1` as its deterministic winner, but the file currently shown in the Android Vault came from revision `C2`:

```text
A1
├── B1 ── C1     database winner
└── B2 ── C2     displayed on Android
```

Android recorded `C2` when it wrote that revision into the Vault. If the user edits the file on Android, the new revision extends `C2`:

```text
A1
├── B1 ── C1
└── B2 ── C2 ── D2     Android edit
```

After synchronisation, both devices receive `C1` and `D2` as the live branches. The edit is not moved silently onto `C1`, and ordinary conflict resolution can compare the real descendants.

### A user deletes the branch shown on one device

If Android deletes the file while it still displays `C2`, LiveSync writes a logical-deletion revision below `C2`:

```text
A1
├── B1 ── C1
└── B2 ── C2 ── D2 (deleted: true)
```

The deletion remains one side of the live conflict. The user can still choose between the content at `C1` and deleting the file. LiveSync does not delete `C1` merely because PouchDB selected it as the winner.

### A user renames a conflicted file

If the user changes only the spelling case, such as `Note.md` to `note.md`, LiveSync keeps the rename in the same revision tree and extends the revision displayed on that device.

If the user renames `draft.md` to `published.md`, LiveSync stores `published.md` before it marks the displayed `draft.md` branch as logically deleted. If an interruption occurs between those operations, the recoverable result is a duplicate which can be reviewed, rather than loss of the only copy. Any other live branch of `draft.md` remains available for conflict resolution.

### A remote resolution reaches a device which still shows the losing content

Android may resolve a conflict and continue editing while Mac still shows the losing revision. When Mac receives the resolved tree, LiveSync searches every available branch and recognises Mac's unchanged bytes as content which was already synchronised below the deleted losing leaf. It can apply Android's resolution without asking Mac to resolve the same unchanged conflict again.

If the user edited the file on Mac before the resolution arrived, the bytes no longer match that historical revision. LiveSync preserves the Mac edit as an unsynchronised conflict instead of overwriting it.

### A three-version review is interrupted

Mac receives three live versions of `shared.md`. The active-file status reports three unresolved versions, and the first dialogue compares the deterministic winner with the first ordered conflict leaf. The user completes that pair, leaving two live versions, then chooses **Not now** on the next dialogue and closes Obsidian.

The first decision has already changed the ordinary revision tree. On restart, LiveSync reads the two surviving versions and presents only that remaining pair; it does not reconstruct the original three-version state. If another device resolves the remaining pair before or while the dialogue is open, the warning disappears and the stale dialogue closes.

### The device-local record is missing

A local-database reset removes revision provenance. On the next scan, if the Vault file matches exactly one available revision, LiveSync can reconstruct which branch was displayed and continue from it. If the bytes match multiple revisions, or no available revision, the branch remains unproved.

In that unproved state, an edit is retained as another manual-resolution branch. A deletion leaves all existing branches intact. A cross-path rename stores the target but leaves every source branch for review. The result can require an extra decision, but it does not discard data by guessing the winner.

### Start-up or reset overlaps a provenance operation

LiveSync creates the provenance handle during composition, then opens its backing store during the sequential settings lifecycle before starting scans, watchers, or replication. If the store cannot open, start-up stops rather than leaving file processing waiting indefinitely.

During reset, the store can be temporarily unavailable. A racing provenance lookup fails promptly and follows the same conservative missing-record behaviour. After reopen, scanning can reconstruct a record when one exact revision body matches the Vault file.

## Unsafe shortcuts

Do not:

- infer a common ancestor from generation numbers alone;
- assume that the PouchDB winner is the version currently displayed in the Vault;
- replace recorded displayed provenance merely because current bytes match another branch;
- discard local content when revision-history lookup fails;
- infer revision identity from path, size, modification time, or content hash without a revision ID;
- select the newest modification time unless the user has explicitly chosen that destructive policy; or
- merge overlapping text edits or unrelated binary contents automatically.

## Verification

Commonlib's real-PouchDB and injected-boundary unit tests cover unequal branch lengths, exact shared ancestry, deterministic ordering of multiple live leaves, a sensible stage followed by reconstruction of a manual pair, content below a deleted losing leaf, recorded and reconstructed branch identity, ambiguous matches, conflict-time editing, missing-body preservation when parent metadata is available, refusal to invent a parent for a generation-one revision, logical deletion, case-only rename, cross-path rename, and safe unproven fallbacks.

LiveSync's optional real-Obsidian two-Vault checks have two scopes. `E2E_OBSIDIAN_INCLUDE_MARKDOWN_CONFLICT=true` resolves and edits a Markdown conflict, propagates it to a Vault which still displays the deleted losing content, and requires one live result to remain. `E2E_OBSIDIAN_INCLUDE_CONFLICT_OPERATIONS=true` edits, deletes, case-renames, and cross-path-renames files while conflicts remain active; it verifies the parent revision of each resulting branch, replicates those exact trees, and confirms that the other live branches remain intact.

The focused `test:e2e:obsidian:conflict-dialog-policy` scenario creates three live versions in one real Obsidian Vault. It verifies the count warning, commits a concatenated child of the displayed winner, confirms that the untouched leaf remains as one conflict, postpones that remaining pair, restarts the isolated Obsidian profile, and confirms that only the live pair is reconstructed. It also verifies that an incoming resolution closes a stale dialogue, completes the waiting conflict operation, and clears the warning. The repair scenario removes a referenced local chunk, confirms that the exact unreadable live revision remains in the tree, and exercises explicit retry and discard controls without deleting another live revision.
