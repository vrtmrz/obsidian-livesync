# Synchronisation status and CSS customisation

Use [General Settings](../settings.md#2-general-settings) to choose whether synchronisation status appears in the status bar, inside the editor, or both. The following sections explain the indicators and how to customise their appearance.

## Status indicators

-   Activity Indicator
    -   📲 A finite remote operation is in progress
    -   🌐N Approximate remote requests currently in progress
-   Status
    -   ⏹️ Stopped
    -   🌀 Starting synchronisation
    -   ⏩ Comparing CouchDB change history, including entries already held locally
    -   💤 LiveSync enabled. Waiting for changes
    -   ⚡️ Synchronisation in progress
    -   ⚠ An error occurred
-   Statistical Indicators
     -   ↑ Uploaded chunks and metadata
     -   ↓ Downloaded chunks and metadata
-   Progress Indicators
     -   📥 Unprocessed transferred items
     -   📄 Working database operation
     -   💾 Working write storage processes
     -   ⏳ Working read storage processes
     -   🛫 Pending read storage processes
     -   📬 Batched read storage processes
     -   ⚙️ Working or pending storage processes for hidden files
     -   🛄 Pending initial on-demand chunk requests
     -   🔁 Pending chunk retries, including retry delays
     -   🔌 Working customisation items (configuration, snippets, and plug-ins)

To prevent file and database corruption, please avoid closing Obsidian until all progress indicators have disappeared as much as possible (although the plug-in will attempt to resume if interrupted). This is especially important if you have deleted or renamed files.

## CouchDB comparison count

When CouchDB change history is being compared, `(⏩ 1200) ↑ 0 ↓ 0` can appear before any new documents arrive. The count is the number of candidate changes-feed entries compared during the current replication attempt, including repeated entries on retries. It is separate from downloaded Chunks and Metadata, and is neither a Vault file count nor a count of entries already present locally. It appears before the upload count, disappears after three seconds without a change, and reappears when the count changes. The ⏩ status icon follows comparison activity independently of that timer.

## Customising status items with CSS snippets

The status bar and editor overlay use individual spans with the common `livesync-stat-` class prefix. CSS snippets can hide or style individual items. For example, this hides the comparison count and P2P summary:

```css
.livesync-stat-ff,
.livesync-stat-p2p {
    display: none;
}
```

The item classes include `livesync-stat-network`, `livesync-stat-sync`, `livesync-stat-sent`, `livesync-stat-push-remaining`, `livesync-stat-arrived`, `livesync-stat-pull-remaining`, `livesync-stat-ff`, and `livesync-stat-p2p`. File-processing items use `livesync-stat-file-processing`, `livesync-stat-file-pending`, and `livesync-stat-file-batched`; queue items use `livesync-stat-queue-` followed by `replication`, `database`, `storage`, `chunk-initial`, `chunk-retrying`, `plugin-scan`, `hidden-files`, or `conflicts`. The skipped-file indicator uses `livesync-stat-file-skip`.

All items also have `livesync-stat-item`. Numeric children use `livesync-stat-value`, tabular digits, and right alignment. Each numeric item retains its widest displayed digit count during an active period, reducing movement as counts decrease. The editor overlay uses wider gaps between items, while remaining counts stay beside their transfer totals.

Inactive items receive `livesync-stat-inactive` instead of the HTML `hidden` attribute. The default CSS hides them immediately. They retain their last text, numeric width, and position amongst the other items so that CSS snippets can customise how they disappear. The numeric width starts afresh when an item becomes active again.

See the [documentation index](../README.md) for setup and troubleshooting guides.
