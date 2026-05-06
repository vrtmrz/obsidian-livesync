# Auto Configuration via Remote Database

## Goal
To prevent fatal synchronisation issues and data corruption caused by misaligned settings across devices by introducing a mechanism that automatically fetches and applies shared configurations from the remote database.

## Motivation
In Obsidian LiveSync, inconsistencies in certain settings across devices (e.g., encryption algorithms, chunk splitting rules) lead to severe issues such as decryption failures or structural breakdowns (e.g., conflicting update loops, wasted storage).
To resolve this, we will introduce an "Auto Configuration" feature. Once database access is established, the plugin will fetch the "Shared Settings" stored on the remote database and automatically keep the local settings up to date.

## Prerequisites
* The configuration parameters must be strictly categorised into synchronised and non-synchronised scopes.
* The feature must be opt-in to prevent unexpected setting overwrites.
* The remote configuration must act as the Single Source of Truth.

## Outlined Methods and Implementation Plans

### 1. Scope of Synchronised Settings
Settings are strictly divided into "shared targets" (defined as constants) and "excluded targets".

* **Synchronised Targets (Centrally managed on the Remote):**
  * **� Efficiency-affecting Settings:** `hashAlg`, `chunkSplitterVersion`, `enableChunkSplitterV2`, `useSegmenter`, `minimumChunkSize`, `customChunkSize`
  * *Note: To ensure resilience against future expansions, these target keys must be defined as constants (e.g., an array) within the codebase, allowing for flexible programmatic processing.*

* **Excluded Targets (Kept locally):**
  * **🔴 Rebuild-Requiring Settings (Incompatible Changes):** `encrypt`, `usePathObfuscation`, `E2EEAlgorithm`, `useDynamicIterationCount`. Changing these requires a full local database rebuild to maintain integrity. Therefore, they are excluded from silent "Auto Configuration" and will continue to rely entirely on the explicit "Tweak Mismatch" resolution dialogue flow.
  * **🛑 Environment Blockers:** `handleFilenameCaseSensitive`. This setting depends inherently on the OS's file system (e.g., Windows/macOS being typically case-insensitive). Attempting to auto-configure this to a state unsupported by the local environment will cause silent corruption. Therefore, it is strictly excluded from Auto Configuration. If a mismatch is detected, the plugin must explicitly block synchronisation with a fatal error.
  * **"Chicken-and-egg" Settings:** `couchDB_URI`, `passphrase`, `remoteType`, and Bucket configurations—settings inherently required to connect to and decrypt the remote database in the first place.
  * **🟢 Client-specific Behaviour & UX:** UI options (e.g., `showVerboseLog`), batch sizes, synchronisation trigger settings, and local file rules, as these are expected to vary per device.

### 2. Opt-in, Initialisation, and Activation Process
To prevent accidents where settings are unexpectedly altered, this feature is strictly "opt-in".
When enabling the feature, the plugin secures user consent via the following dialogue flow, depending on the state of the Remote DB:

1. The user turns on "Auto Configuration".
2. The plugin attempts to fetch the configuration document from the Remote database.
3. **If the configuration document does NOT exist on the Remote:**
   * Dialogue: "No shared configuration was found on the remote database. Would you like to save this device's current settings to the remote as the standard configuration and enable auto-configuration?"
   * Upon consent: The plugin writes the current local settings (only the target keys) to the Remote, appending a timestamp.
4. **If the configuration document exists on the Remote:**
   * Dialogue: "A shared configuration was found on the remote database. Would you like to overwrite this device's settings with the remote standard and enable auto-configuration?"
   * Upon consent: The plugin fetches the settings from the Remote and applies them locally.

### 3. Version Control (Timestamps) and Continuous Synchronisation
* **Single Source of Truth:** The configuration document stored in the Remote database is always treated as the definitive master record.
* **Timestamp Management:** The configuration document saved on the Remote holds a last-modified timestamp (or version number).
* **Update Flow:** When a user alters and saves settings locally, the plugin communicates with the Remote to ensure it possesses the latest state before applying changes. It then writes back the updated settings to the Remote, assigning a newer timestamp.

### 4. UX Considerations for Offline Scenarios
If a user opens the settings screen while offline and attempts to edit shared settings, the plugin must explicitly communicate the limitations:
* **Warning Notice:** "Unable to fetch the latest settings from the server. If you modify settings now, they might be overwritten by the server's configuration the next time you connect (Alternatively, shared settings can only be saved whilst online)."
* *Rationale:* This prevents user confusion and wasted effort, mitigating frustrations such as "I changed my settings, but they reverted themselves".
