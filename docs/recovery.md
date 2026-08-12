# Recovery and flag files

This guide covers emergency suspension, local database recovery, and deliberate remote reconstruction. These operations are not ordinary synchronisation.

> [!IMPORTANT]
> Back up every available Vault before recovery. If a central remote is involved, back up that database or bucket as well. Stop or suspend other LiveSync devices until you have chosen the authoritative copy.

If Obsidian will not start normally, do not give up. Flag files can be created or removed with the operating system's file manager while Obsidian is closed. They are the only supported way to intervene before the ordinary LiveSync boot-up sequence reaches its database and synchronisation work.

## First choose the authoritative copy

Use the least destructive operation which matches the evidence:

- If the correct data is uncertain, suspend all work with `redflag.md`, preserve every copy, and inspect them before proceeding.
- If the central remote is healthy and should win, use **Reset Synchronisation on This Device** or `flag_fetch.md`.
- If this device's Vault is healthy and should replace a damaged or unwanted central remote, use **Overwrite Server Data with This Device's Files** or `flag_rebuild.md`.
- If both the Vault and local database are healthy and the only concern is unused storage, Garbage Collection may be appropriate. It does not repair a damaged database.

Do not switch transport, enable P2P, or run Garbage Collection as a substitute for diagnosing a stopped CouchDB or Object Storage setup.

## Suspend before diagnosis

Close Obsidian completely, then create an empty file or directory named `redflag.md` at the root of the Vault. On the next start, LiveSync enters its emergency suspension state before ordinary database, file-watching, and synchronisation work continues.

While suspended:

1. Back up the Vault and any available remote data.
2. Check which device or remote contains the intended files.
3. Correct only the identified configuration or storage problem.
4. Remove `redflag.md`.
5. Start Obsidian and review the remaining suspension controls under `Hatch` -> `Scram Switches`.

The flag deliberately enables file logging, which may affect performance. Remove it after the emergency has been understood.

## Recover a conflicted or mismatched file

Use this workflow when one file, or a small number of known files, has conflicts, missing chunks, or a difference between the current Vault file and the local LiveSync database. The inspection is device-local: it does not query a remote database or prove that another device has the same chunks.

The `Hatch` recovery controls are ordered by escalation. Running **Recreate chunks for current Vault files** again with unchanged chunk settings and file contents produces the same chunks, and does not alter the revision tree. **Inspect conflicts and file/database differences** then provides actions for exact revisions. **Resolve All conflicted files by the newer one** is last because it applies a modification-time policy in bulk and logically deletes every other live version.

1. Stop editing the affected file, pause replication on the participating devices, and keep a separate copy of every readable version.
2. If another device or backup has the intended content, preserve that copy before changing any revision.
3. If the current Vault file is readable, select **Recreate current chunks**. This can restore only chunks derived from the current Vault contents; it cannot reconstruct unique bytes from an unavailable historical or conflict revision.
4. Select **Inspect conflicts and file/database differences** → **Begin inspection**.
5. Review the database winner, every conflict revision, and any unavailable shared ancestor separately. Revision identifiers, `Δsize`, `Δtime`, and chunk availability are diagnostic evidence; they do not decide which content is correct.
6. Use the wrench menu on the exact revision:
   - **Compare with Vault** opens a read-only comparison for readable text.
   - **Apply this revision to Vault** replaces the Vault file with that readable database revision.
   - **Mark this revision as the Vault version** records an exact byte-for-byte match without creating a child revision.
   - **Store Vault file as a child of this revision** preserves the current Vault bytes on that selected branch.
   - **Retry reading revision** retries configured chunk retrieval without changing the revision tree.
   - **Apply logical deletion to Vault**, **Discard this branch**, and **Discard unreadable revision** are destructive decisions. Use them only after preserving every version which may still be needed.
7. Synchronise the healthy source if chunks were restored, scan again, and confirm that the expected conflict or difference has disappeared before resuming ordinary editing.

An absent Vault file and a logical-deletion winner already agree and do not require a repair card unless another live branch remains. If the scan reports many unrelated files, or the local database itself is incomplete or corrupt, stop the per-file workflow and use [Reset synchronisation on this device](#reset-synchronisation-on-this-device) from a trusted remote. If the central remote must instead be reconstructed from an authoritative Vault, use [Overwrite server data with this device's files](#overwrite-server-data-with-this-devices-files).

Metadata document-ID mismatches use a separate action in the same Inspector. Follow [Repair a Metadata document ID mismatch](#repair-a-metadata-document-id-mismatch) rather than applying a file revision by path.

## Repair a Metadata document ID mismatch

Use this workflow when **Inspect conflicts and file/database differences** reports `Metadata entry requires review and was left unchanged`. The Inspector found local Metadata whose stored document ID no longer represents its recorded path. It leaves the entry unchanged, while any consistently addressed Metadata for the same logical path remains available to ordinary inspection and Vault reflection. This inspection does not query the remote.

1. Back up this device. If other devices share the database, stop editing and pause synchronisation on them.
2. Confirm that the current file-name case and path obfuscation settings are intended for this database. If either setting was deliberately changed for the whole database, stop this workflow and use Rebuild instead.
3. Open **Self-hosted LiveSync settings** → **Hatch** → **Inspect conflicts and file/database differences**, then select **Begin inspection**.
4. Find the affected Metadata card and review its recorded path, stored document ID, expected document ID, and source revision.
5. Continue only when the card says `Repair is available for this entry.` Open its wrench menu and select **Repair this Metadata document ID**. If the action is unavailable, do not force an ID: the entry is ambiguous, conflicted, deleted, outside the normal-file namespace, or otherwise unsafe for one-entry repair.
6. Review the warning and select **Repair Metadata ID**. LiveSync rechecks the source revision and expected ID, writes and verifies the target, then removes the obsolete ID.
7. Wait for the ordinary Vault scan to complete. If LiveSync reports that the repair completed but the scan did not run, keep synchronisation paused, resolve the reported scan condition, then run the **Scan storage and database again** command.
8. Allow this device to upload the repair. Resume the other devices one at a time, then run the inspection again and confirm that the Metadata card no longer appears and the Vault file has the intended content.

This action changes one local database entry. It does not rename Vault files or folders, repair several entries at once, coordinate other devices, or preserve CouchDB revision ancestry across the two document IDs.

If many entries reflect folder-name differences across devices, stop every device, choose the authoritative Vault, close Obsidian, correct the actual storage names with operating-system tools, then rebuild the central remote from that Vault and reset the other devices. During Fast Setup on an empty Vault, there are no storage names to correct: allow consistently addressable Metadata to be reflected, then inspect any remaining unresolved references.

## Reset synchronisation on this device

Use this when the remote copy is trusted but this device's local LiveSync database is incomplete, corrupt, or no longer aligned with it.

The readable flag is `flag_fetch.md`; the legacy name `redflag3.md` remains accepted.

On the next start, LiveSync:

1. pauses ordinary start-up work;
2. asks which remote to use when more than one remote profile exists;
3. asks how to treat existing Vault files;
4. discards and reconstructs the local LiveSync database from the selected remote; and
5. resumes only after the scheduled operation has completed or been cancelled safely.

Fast Setup retains its fetch flag, last successfully stored remote position, and selected data-processing method when an error while decrypting data, reading the remote response, or writing to the local database stops the reconstruction. File watching and database reflection remain suspended. Review the first specific error in **Show log**, correct its cause, then restart Obsidian to retry from the retained state. Do not remove the fetch flag or resume the Scram switches while you intend to continue the operation. If the same error remains, leave LiveSync suspended and [collect a report](troubleshooting.md#collect-a-report).

For P2P, a source peer must be online, discovered, and selected in `P2P Rebuild`. Merely opening an empty signalling room does not complete Fetch. Closing the rebuild dialogue without selecting a peer reports failure and does not treat the local database as restored.

Review the [Fast Setup guide](tips/fast-setup.md) before using this operation on a Vault which contains unsynchronised local work.

## Overwrite server data with this device's files

Use this only when this device's Vault is the authoritative copy and the central remote should be reconstructed from it.

The readable flag is `flag_rebuild.md`; the legacy name `redflag2.md` remains accepted.

For CouchDB and Object Storage, this is destructive to the selected remote state. Other devices may still contain revisions or files which are not present in the authoritative Vault, so keep them stopped until the new remote has been verified and then reset them from that remote.

For a P2P-only setup, there is no central remote database to overwrite. Preparing the first device instead rebuilds its local LiveSync database from its Vault.

## Garbage Collection is not Rebuild

Garbage Collection removes unreferenced chunks while preserving the current database and its revision model. Use it only when:

- the Vault is healthy;
- the local LiveSync database is healthy;
- all relevant devices have synchronised; and
- the remaining historical and deletion state is understood.

Deleted documents, tombstones, live conflicts, and retained metadata are not free. Live conflict branches keep the chunks needed for review, while an ordinary superseded linear revision does not protect its former chunks. Garbage Collection can therefore make old content unreadable and cannot promise the smallest possible remote. Review the [Garbage Collection V3 specification](specs_garbage_collection.md) before using it.

Rebuild is a different operation. It reconstructs the database from a chosen authoritative state and is the more certain way to remove unwanted history or repair a damaged remote, but it is also more disruptive and can discard changes which exist only elsewhere.

## Flag-file reference

Create only the flag required for the chosen operation.

| File at the Vault root | Effect |
| --- | --- |
| `redflag.md` | Suspend ordinary LiveSync work for diagnosis. It remains until removed manually. |
| `flag_fetch.md` or `redflag3.md` | Schedule **Reset Synchronisation on This Device** from the selected remote. |
| `flag_rebuild.md` or `redflag2.md` | Schedule **Overwrite Server Data with This Device's Files**, or local P2P preparation when no central remote exists. |

Flag files themselves are excluded from synchronisation. Fetch and rebuild flags are removed by the scheduled workflow after completion or safe cancellation. A failed Fast Setup retains its fetch flag so that a later start can retry it; `redflag.md` is a manual emergency stop.

## When the warning continues

If LiveSync still reports emergency suspension after a recovery dialogue has closed:

1. close Obsidian completely;
2. inspect the Vault root for every name in the table above;
3. remove only flags whose intended operation has finished or been abandoned;
4. restart Obsidian; and
5. check `Hatch` -> `Scram Switches` for remaining suspended file watching or database reflection.

If the intended authoritative copy is still uncertain, leave synchronisation suspended and collect a [full report](troubleshooting.md#collect-a-report) before changing the databases again.
