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
- If both the Vault and local database are healthy and the only concern is unused storage, Garbage Collection may be appropriate. It is not a damaged-database recovery operation.

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

## Reset synchronisation on this device

Use this when the remote copy is trusted but this device's local LiveSync database is incomplete, corrupt, or no longer aligned with it.

The readable flag is `flag_fetch.md`; the legacy name `redflag3.md` remains accepted.

On the next start, LiveSync:

1. pauses ordinary start-up work;
2. asks which remote to use when more than one remote profile exists;
3. asks how to treat existing Vault files;
4. discards and reconstructs the local LiveSync database from the selected remote; and
5. resumes only after the scheduled operation has completed or been cancelled safely.

For P2P, a source peer must be online, discovered, and selected in `P2P Rebuild`. Merely opening an empty signalling room does not complete Fetch. Closing the rebuild dialogue without selecting a peer reports failure and does not treat the local database as restored.

Review the [Fast Setup guide](tips/fast-setup.md) before using this operation on a Vault which contains unsynchronised local work.

## Overwrite server data with this device's files

Use this only when this device's Vault is the authoritative copy and the central remote should be reconstructed from it.

The readable flag is `flag_rebuild.md`; the legacy name `redflag2.md` remains accepted.

For CouchDB and Object Storage, this is destructive to the selected remote state. Other devices may still contain revisions or files which are not present in the authoritative Vault, so keep them stopped until the new remote has been verified and then reset them from that remote.

For a P2P-only setup, there is no central remote database to overwrite. The corresponding first-device preparation rebuilds this device's local LiveSync database from its Vault.

## Garbage Collection is not Rebuild

Garbage Collection removes unreferenced chunks while preserving the current database and its revision model. Use it only when:

- the Vault is healthy;
- the local LiveSync database is healthy;
- all relevant devices have synchronised; and
- the remaining historical and deletion state is understood.

Deleted documents and tombstones are not free, and historical revisions may keep chunks reachable. Garbage Collection therefore cannot promise the smallest possible remote.

Rebuild is a different operation. It reconstructs the database from a chosen authoritative state and is the more certain way to remove unwanted history or repair a damaged remote, but it is also more disruptive and can discard changes which exist only elsewhere.

## Flag-file reference

Create only the flag required for the chosen operation.

| File at the Vault root | Effect |
| --- | --- |
| `redflag.md` | Suspend ordinary LiveSync work for diagnosis. It remains until removed manually. |
| `flag_fetch.md` or `redflag3.md` | Schedule **Reset Synchronisation on This Device** from the selected remote. |
| `flag_rebuild.md` or `redflag2.md` | Schedule **Overwrite Server Data with This Device's Files**, or local P2P preparation when no central remote exists. |

Flag files themselves are excluded from synchronisation. Fetch and rebuild flags are removed by the scheduled workflow after completion or cancellation; `redflag.md` is a manual emergency stop.

## When the warning continues

If LiveSync still reports emergency suspension after a recovery dialogue has closed:

1. close Obsidian completely;
2. inspect the Vault root for every name in the table above;
3. remove only flags whose intended operation has finished or been abandoned;
4. restart Obsidian; and
5. check `Hatch` -> `Scram Switches` for remaining suspended file watching or database reflection.

If the intended authoritative copy is still uncertain, leave synchronisation suspended and collect a [full report](troubleshooting.md#collect-a-report) before changing the databases again.
