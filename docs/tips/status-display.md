# Synchronisation status and CSS customisation

Use [General Settings](../settings.md#2-general-settings) to choose whether synchronisation status appears in the status bar, inside the editor, or both. The following sections explain the indicators and how to customise their appearance.

## Status indicators

-   Activity Indicator
    -   📲 A finite remote operation is in progress
    -   🌐N Approximate remote requests currently in progress
-   Status
    -   ◌ A new replicator has not yet established a connection
    -   ⏹ The replication session is closed
    -   ✅ The current finite replication has completed. Vault file reflection can continue separately.
    -   🌀 Starting synchronisation
    -   ⏩ Comparing CouchDB change history, including entries already held locally
    -   💤 Waiting for changes, or an idle P2P peer
    -   ⚡ Synchronisation in progress
    -   ⚠ An error occurred
-   Statistical Indicators
     -   ↑ Database document revisions sent
     -   ↓ Database document revisions received
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

For CouchDB and P2P, numbers in parentheses show the remaining sequence distance to the source's sequence at the start of that replication direction. The value counts down to `(0)` when the position reaches or passes that boundary. The parentheses are omitted when the position has not been reported. For P2P, the number after `↑` or `↓` is the transferred document revision count; `‒` means that count has not been reported, while `0` is a measured zero. For example, an active peer at sequence 800 of 900 with two sent revisions shows `⚡ peer-a ↑ 2 (100)`. The P2P peer name identifies the other device.

To prevent file and database corruption, please avoid closing Obsidian until all progress indicators have disappeared as much as possible (although the plug-in will attempt to resume if interrupted). This is especially important if you have deleted or renamed files.

## Configured automatic synchronisation

A framed badge shows the automatic synchronisation configured for a CouchDB or S3-compatible Object Storage remote. It appears first in the status bar and editor overlay when their respective displays are enabled:

| Symbol | Configured triggers |
| --- | --- |
| 🔗 | LiveSync mode |
| ⏰ | Periodic synchronisation |
| ✨ | At least one event trigger: file save, editor save, start-up, file open, or file merge |
| 🛎 | Manual synchronisation only; all ordinary automatic triggers are disabled |

Enabled groups appear together: `⏰ ✨` means periodic and event synchronisation are configured. The badge describes the settings, while the following status items describe current replication activity. A thin, theme-coloured divider separates the status from items before it, such as the mode badge or network activity; the divider is omitted when the status is first. For example, `🔗 │ 💤 ↑ 0 ↓ 0` shows a mode badge, divider, waiting status, and directional totals. The `│` in the example represents a CSS border, not a text character. A configured mode does not establish that the device is connected or that file and database reflection is enabled. Unconfigured Vaults and P2P main remotes do not show this badge; P2P uses its own connection and automatic synchronisation settings.

Fetch and Rebuild deliberately disable automatic synchronisation. Completion does not restore the previous mode, so the badge then shows 🛎. A completed operation can still leave conflicts to review. Please review the resulting Vault and any conflicts before choosing the intended triggers under **Sync Settings** → **Synchronization Method**.

## CouchDB comparison count

When CouchDB change history is being compared, directional counts can appear before any new documents arrive, for example `⏩ (⏩↑ 1200) (⏩↓ 84) ↑ 0 ↓ 0`. The `⏩↑` count is for the push direction, and `⏩↓` is for the pull direction. Each counts candidate changes-feed entries compared during the current replication attempt, including entries which do not need to be transferred and repeated entries on retries. They are feed-entry counts, not counts of Vault files which need to be transferred.

Each directional count has its own display timer. A positive count remains visible for three seconds after its last change, then clears; a count which reaches zero clears immediately. A change in one direction does not extend the other direction's timer. The ⏩ status icon follows comparison activity independently of these timers.

## Customising status items with CSS snippets

The status bar and editor overlay use individual spans with the common `livesync-stat-` class prefix. CSS snippets can hide or style individual items. For example, this hides both directional comparison counts and the P2P summary:

```css
.livesync-stat-ff-push,
.livesync-stat-ff-pull,
.livesync-stat-p2p {
    display: none;
}
```

The item classes include `livesync-stat-sync-mode`, `livesync-stat-network`, `livesync-stat-sync`, `livesync-stat-sent`, `livesync-stat-push-remaining`, `livesync-stat-arrived`, `livesync-stat-pull-remaining`, `livesync-stat-ff-push`, `livesync-stat-ff-pull`, and `livesync-stat-p2p`. File-processing items use `livesync-stat-file-processing`, `livesync-stat-file-pending`, and `livesync-stat-file-batched`; queue items use `livesync-stat-queue-` followed by `replication`, `database`, `storage`, `chunk-initial`, `chunk-retrying`, `plugin-scan`, `hidden-files`, or `conflicts`. With **Show status icon instead of file warnings banner** enabled, the framed `livesync-stat-file-skip` item shows `📄⛔` for a file excluded from synchronisation or `📄⚠️` for a compatibility warning; the details remain in the editor warning area when that banner is enabled.

The former `livesync-stat-ff` class has been replaced by `livesync-stat-ff-push` and `livesync-stat-ff-pull`. Update existing CSS snippets to target one or both of the directional classes.

All items also have `livesync-stat-item`. Numeric children use `livesync-stat-value`, tabular digits, and right alignment. Each numeric item retains its widest displayed digit count during an active period, reducing movement as counts decrease. The editor overlay uses wider gaps between items, while remaining counts stay beside their transfer totals.

Inactive items receive `livesync-stat-inactive` instead of the HTML `hidden` attribute. The default CSS hides them immediately. They retain their last text, numeric width, and position amongst the other items so that CSS snippets can customise how they disappear. The numeric width starts afresh when an item becomes active again.

### Animate editor status items

This optional CSS snippet shrinks inactive items in the editor status line and expands them when they reappear. It applies to all status items in that line. Because inactive items remain in the DOM, their width can transition as their state changes; the initial creation of an item is not guaranteed to animate. Text changes, including on first appearance, do not necessarily animate an item's width. The `@supports` guard leaves the default, immediate hiding behaviour in place in CSS engines which do not support `calc-size()`.

```css
@supports (width: calc-size(auto, size)) {
    .livesync-status-statusline > .livesync-stat-item {
        font-variant-numeric: tabular-nums;
        transition: width 0.125s;
        display: inline-block;
        width: calc-size(auto, size);
        overflow: hidden;
        white-space: nowrap;
    }

    .livesync-status-statusline > .livesync-stat-item.livesync-stat-inactive {
        transition: width 0.46s;
        display: inline-block;
        width: calc-size(auto, size * 0);
        overflow: hidden;
        white-space: nowrap;
        margin-inline-start: 0 !important;
    }

    @media (prefers-reduced-motion: reduce) {
        .livesync-status-statusline > .livesync-stat-item {
            transition: none;
        }

        .livesync-status-statusline > .livesync-stat-item.livesync-stat-inactive {
            transition: none;
        }
    }
}
```

The snippet affects the editor overlay only; the status bar keeps its default appearance. See the [`calc-size()` reference](https://developer.chrome.com/docs/css-ui/animate-to-height-auto/) for the CSS feature used to calculate an item's intrinsic width.

See the [documentation index](../README.md) for setup and troubleshooting guides.
