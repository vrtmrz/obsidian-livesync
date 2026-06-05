# Fast Setup (Simple Fetch)

Fast Setup is a streamlined, user-friendly data retrieval and initialisation flow designed to simplify setting up secondary devices or recovering databases. 

Instead of guiding the user through the detailed multi-step setup wizard dialogues, Fast Setup prompts the user with high-level sync decisions and automates database download and local storage scanning in one continuous process.

---

## How It Works

When you import a **Setup URI** on a secondary device, or when a **Fetch All** operation is triggered (such as by placing a `redflag3.md` / `flag_fetch.md` flag file at the root of the vault), the plug-in schedules remote data retrieval.

On the next startup, the plug-in boots in scheduled fetch mode and opens a simplified dialogue: **"Data retrieval scheduled"**.

---

## Technical Characteristics

Fast Setup leverages several backend optimisations to make the retrieval fast, safe, and clean:

1. **Stream-based Replication for Speed**
   - It fetches all remote metadata via stream reception, which is significantly faster than traditional chunk-by-chunk retrieval.
2. **Delayed File Reflection to Prevent Corrupted Warnings**
   - By suspending file reflection during the download phase, it prevents the plug-in from raising temporary or false "corrupted data synchronisation" or "size mismatch" warnings that can occur during the chunk download process.
3. **Time-Based Comparison is Generally Sufficient**
   - Since the vault is entering a fresh synchronisation or recovery state, comparing files based on their modification timestamps (newer-wins) is highly reliable and sufficient to reconcile files without needing complex manual conflict resolution.

---

## Step-by-Step Guide

### Step 1: Choose Data Processing Method
You will be prompted to choose how the retrieved remote data will interact with your existing local files:

1. **Compare time and take newer (newer-wins)**
   - Compares the modified time of files and accepts the newer version.
   - **Recommended if:** You have been using Self-hosted LiveSync and have made changes on multiple devices that you want to merge.
2. **Overwrite all with remote files (remote-wins)**
   - Remote data is treated as the source of truth.
   - **Recommended if:** You are setting up a brand new device with an empty or clean vault.
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
