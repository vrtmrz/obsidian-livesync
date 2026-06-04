# Notes on Terminology, Spelling, Vocabulary Conventions

## Spelling and Vocabulary conventions

1. Almost all of the english words are written in British English. For example, "organisation" instead of "organization", "synchronisation" instead of "synchronization", etc. This convention originated from the author's personal preference but is now maintained for consistency.

2. Idiomatic terms, such as those used in HTML, CSS, and JavaScript, are usually aligned with the language used in the technology. For example, "color" instead of "colour", "program" instead of "programme", etc. Especially, terms which are used for attributes, properties, and methods are notable.

3. We use `dialogue` in documentation for consistency. While `dialog` may appear in source code, particularly in class names, method names, and attributes (following technical conventions in No. 2), we consistently use `dialogue` for user-facing messages and general documentation text. This approach balances No. 1 with No. 2.

4. Contractions are not used. For example, "do not" instead of "don't", "cannot" instead of "can't", etc., especially `'d`.
   - We may encounter difficulties with tenses.

5. However, try using affirmative forms, `Discard` instead of `Do not keep`, `Continue` instead of `Do not stop`, etc.
    - Some languages, such as Japanese, have a different meaning for `yes` and `no` between affirmative and negative questions.

### Terminology

- Chunk / Chunks
    - Divided units of data stored in the database or object storage to facilitate efficient synchronisation.
- Compaction
    - A database maintenance procedure that discards old historical document revisions to shrink the remote database size.
- Custom HTTP Handler / Use Internal API (CORS Bypass Settings)
    - Settings used to bypass CORS restrictions by routing requests through Obsidian's native request APIs. There are two distinct settings under the hood depending on the remote server type:
        - **For S3-compatible Object Storage (useCustomRequestHandler)**: Labeled as **"Use Custom HTTP Handler"** in the standard settings tab, **"Use internal API"** in the Svelte-based Setup Wizard dialogue, and represented as `useProxy` in the Setup URI's query parameters due to an unfortunate misunderstanding during development.
        - **For CouchDB (useRequestAPI)**: Labeled as **"Use Request API to avoid `inevitable` CORS problem"** in the standard settings tab, **"Use Internal API"** in the Svelte-based Setup Wizard dialogue, and represented as `useRequestAPI` in the Setup URI's query parameters.
- Customisation Sync
    - The feature that synchronises settings, snippets, themes, and plug-ins. Write with an "s" in documentation (`Customisation`), though technical configurations and links may use `customization`.
- Database Adapter (IDB vs. IndexedDB)
    - The local database storage interface used by PouchDB. The `IDB` adapter is recommended since the older `IndexedDB` adapter is obsolete and known to cause memory leaks in `LiveSync` mode. Users can switch between these adapters without a full database rebuild, although a local data migration and an Obsidian restart are required.
- Database Suffix (additionalSuffixOfDatabaseName)
    - A unique suffix appended to the database name to allow synchronising multiple vaults with the same name on the same remote server.
- E2EE Algorithm
    - The cryptographic algorithm version used for end-to-end encryption. All devices in the synchronisation group must be configured with a compatible version (such as `V2` or `V1`).
- Eden (Eden Chunks)
    - A performance optimisation where newly created chunks are held within the document until they stabilise, before graduating to independent chunks.
- Flag files (redflag.md, redflag2.md, redflag3.md)
    - Special Markdown files (or directories) placed at the root of the vault to stop the boot-up sequence or trigger recovery tasks. For instance, `redflag.md` suspends all processes, while `redflag2.md` (`flag_rebuild.md`) triggers a full database rebuild and `redflag3.md` (`flag_fetch.md`) discards the local database to fetch it again from the remote.
- Garbage Collection (GC)
    - The process of identifying and purging unreferenced chunks (unused data) from local and remote databases to reclaim storage space.
- Hidden File Sync
    - The feature that synchronises files located in hidden directories (like `.obsidian`).
- LiveSync
    - A very confusing term.
        - As a shortened form of `Self-hosted LiveSync`.
        - As the name of a synchronisation mode. This should be changed to `Continuous`, in contrast to `Periodic`.
- livesync-serverpeer / webpeer
    - Pseudo-clients that assist in WebRTC peer-to-peer communication.
- OneShot Sync
    - A single, immediate bidirectional synchronisation (pull then push) triggered on demand or on specific events, as opposed to continuous (live) replication.
- Overwrite Server Data with This Device's Files
    - A maintenance operation (formerly known as `Rebuild everything`) that discards the remote database and reconstructs it by uploading all current local files as a fresh database, overwriting any remote changes.
- Path Obfuscation
    - A privacy option that encrypts file paths and folder names on the remote server.
- plug-in
    - We use the hyphenated form `plug-in` in user-facing messages and general documentation, while `plugin` may appear in codebase files, configuration settings, or technical contexts.
- Remediation (maxMTimeForReflectEvents)
    - A recovery setting that restricts the propagation of changes from the database to local storage, ignoring any file events (such as accidental mass deletions) that occurred after a specified date and time.
- Reset Synchronisation on This Device
    - A maintenance operation (formerly known as `Fetch everything`) that discards the local database and reconstructs it by downloading all data from the remote server.
- Scram (Scram Switches)
    - Emergency controls in the settings that allow users to suspend file watching or database writes to prevent corruption.
- Segmenter (Segmented-splitter)
    - A chunking method that divides files on semantic boundaries (such as paragraphs or sections) rather than arbitrary byte boundaries.
- Self-hosted LiveSync
    - The name of this plug-in. `Self-hosted` is one word.
- Setting Doctor (Config Doctor)
    - A diagnostic utility that checks for mismatches or suboptimal configurations, presenting users with ideal values and recommendation reasons to easily resolve issues during migration, configuration import, or general troubleshooting.
- Setup URI
    - An encrypted representation of the plug-in's settings containing server configuration, which allows users to clone their configuration across devices securely using a passphrase.
- Sync Mode
    - The replication trigger mechanism. Users can select from `On Events` (synchronising on local file changes), `Periodic and Events` (synchronising at fixed intervals as well as on events), or `LiveSync` (continuous, real-time synchronisation).
- Update Thinning (Batch database update)
    - An optimisation that groups multiple local file edits together over a short delay before committing them to the local database, reducing the number of database write operations.
- WebRTC P2P (Peer-to-Peer)
    - A synchronisation method enabling direct communication between devices without a central server database.

