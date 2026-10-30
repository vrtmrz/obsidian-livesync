# Fast Setup (Simple Fetch)

Fast Setup (Simple Fetch) is the preferred flow for initial replication to a new or empty secondary device. It can also be used for recovery, but a retrieval choice may replace local files. Preserve valuable local and remote copies before choosing how to handle a Vault that already contains work. See [Recovery and flag files](../recovery.md#first-choose-the-authoritative-copy) for guidance on identifying the authoritative copy.

Instead of guiding the user through the detailed multi-step setup wizard dialogues, Fast Setup prompts the user with high-level synchronisation decisions and automates data retrieval and local storage scanning in one process. The retrieval path depends on the selected remote.

---

## How It Works

When you import a **Setup URI** on a secondary device, or when a **Fetch All** operation is triggered (such as by placing a `redflag3.md` / `flag_fetch.md` flag file at the root of the vault), the plug-in schedules remote data retrieval.

On the next startup, the plug-in boots in scheduled fetch mode and opens a simplified dialogue: **"Data retrieval scheduled"**.

---

## Technical Characteristics

Fast Setup uses several retrieval and reflection behaviours:

1. **Stream-based Fast Fetch for CouchDB**
   - The stream-based Fast Fetch path is CouchDB-specific. It retrieves remote Metadata incrementally; Object Storage and P2P use their own retrieval paths.
2. **Delayed File Reflection to Prevent Corrupted Warnings**
   - Delaying local file reflection during retrieval suppresses temporary synchronisation warnings while remote data is being fetched.
3. **Timestamp Comparison Selects a Whole File**
   - **Compare time and take newer** compares modification timestamps and selects one whole-file version. It does not merge file contents. Before choosing this policy for a Vault with existing work, preserve valuable local and remote edits and review [Recovery and flag files](../recovery.md#first-choose-the-authoritative-copy).

---

## Step-by-Step Guide

### Step 1: Choose Data Processing Method
You will be prompted to choose how the retrieved remote data will interact with your existing local files:

1. **Compare time and take newer (newer-wins)**
   - Compares the modified time of files and selects the newer whole-file version; it does not combine edits from both versions.
   - **Recommended if:** You have preserved both versions and deliberately want to select one according to its modification time.
2. **Overwrite all with remote files (remote-wins)**
   - Remote data is treated as the source of truth.
   - **Recommended if:** You are setting up a new secondary device with an empty Vault.
   - *Warning: This will overwrite local files with remote files. Please ensure you have a backup of your local vault before proceeding.*
3. **Use the detailed flow (legacy)**
   - Switches back to the detailed, traditional setup wizard dialogues.
   - **Recommended if:** You want full control over the step-by-step database setup options.

### Step 2: Configure Conflict & Deletion Rules
Depending on your choice in Step 1, you will configure how to handle mismatches:

#### If you chose "Compare time and take newer":
- **Delete local files if they were deleted on remote**
  - Keeps your local vault clean by removing files that have already been deleted on other devices.
- **Recreate remote files even if they were deleted on remote**
  - Preserves local files and uploads them back to the remote database, even if they were deleted on other devices.

#### If you chose "Overwrite all with remote files":
- **Delete local files if not on remote**
  - Removes local-only files so that your local vault matches the remote database exactly.
- **Keep local files even if not on remote**
  - Retains all existing local-only files, although this may result in duplicates that you will need to clean up manually after synchronisation.

### Step 3: Automated Synchronisation
Once you confirm your choices:
1. The plug-in performs a fast download of the remote database (`fetchLocalDBFast`).
2. It automatically runs a full scan (`synchroniseAllFilesBetweenDBandStorage`) in the foreground to reflect database changes in your local vault files immediately.
3. The plug-in finalises the process and resumes normal operational status.

### If Fast Setup Stops

Fast Setup records the last successfully stored remote position as it saves documents. A transient connection interruption is retried automatically from that position. The operation reports completion only after the captured remote state has been stored successfully.

If an error while decrypting data, reading the remote response, or writing to the local database stops the operation, LiveSync does not run the Vault scan or finalise the reconstructed local database. It retains the saved position and the fetch flag. Any valid stored choices remain available for confirmation on restart. File watching and database reflection also remain suspended so that a partly reconstructed database cannot be applied to the Vault or combined with new local changes.

Review the first specific error in **Show log**, correct its cause, then restart Obsidian to retry from the retained state. While you intend to continue the operation, do not remove the fetch flag or manually resume the Scram switches. If the same error remains after a restart, leave LiveSync suspended, preserve the available data, and [collect a report](../troubleshooting.md#collect-a-report).


## Remembered choices in the fetch flag

Fast Setup stores its choices in a `json` code block inside `flag_fetch.md` (or
`redflag3.md` when that is the only fetch flag). The file remains Markdown and
can be opened and edited in Obsidian. Explanatory text outside the state block
is preserved when the choices are updated. The entire flag file is temporary:
it is removed when the operation completes or is cancelled.

After an interruption, a restart shows the current remote and the saved
choices. We can continue with those choices, choose again, or cancel the
scheduled Fetch. Saved choices are never applied without confirmation, even
when the previous Fetch completed but its flag could not be removed.

Starting a new Join or scheduling another Fetch replaces `flag_fetch.md` with
an empty flag and asks for new choices. If both filenames exist, `flag_fetch.md`
takes precedence, including when it is empty; completion removes both aliases.

The generated block has `type: "livesync-fast-setup"`, `version: 1`, and the two
stable English choice values (`stage1` and `stage2`). It stores no connection
credentials. Only recognised combinations of the existing choices are accepted.
The confirmation applies the choices to the currently selected remote,
including after changing P2P connection settings.

An empty flag starts the normal choice dialogues. If a non-empty flag has no
readable supported selection, the plug-in asks whether to choose new options
and continue. This includes malformed JSON, unsupported versions, duplicate
state blocks, and incomplete Markdown fences. Continuing leaves the file
contents unchanged and uses the new choices only for that attempt. Another
restart asks again; the plug-in does not repair the Markdown or append a
replacement block. Completing or cancelling the Fetch removes the entire flag,
including any explanatory text.

A storage read or write failure stops the operation; it is not treated as an
empty flag. If flag deletion fails at the end, file watching and database
reflection remain suspended until the failure is resolved. A remaining flag
will ask for confirmation again on restart.

Older versions stored choices separately in device-local storage. Those values
are no longer reused because they may have survived a completed Fetch. After
updating during an interrupted operation, confirm the choices once more. This
change does not itself remove downloaded data or the Fast Fetch checkpoint.
