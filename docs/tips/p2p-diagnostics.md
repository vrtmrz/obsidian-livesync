# Diagnose P2P synchronisation

Use **P2P Status** to distinguish peer discovery, authentication, and data
transfer before changing connection or database settings.

Participating devices must use
[compatible P2P transport versions](../p2p.md#updating-a-p2p-group).
If your version does not show **Diagnostic summary**, use
[Peer-to-Peer Synchronisation Tips](p2p-sync-tips.md) and include the installed
versions in your report.

## Capture one attempt

1. Keep both devices online, with Obsidian visible and the devices awake.
   Record which device originates the change and which should receive it.
2. Open **P2P Status** on both devices, using
   **Self-hosted LiveSync: P2P Sync : Open P2P Status** in the command palette.
3. Expand **Diagnostic summary** below **Stats**. It starts collapsed. Record
   all three rows and their observation times before reconnecting or changing
   settings.
4. Turn **Diag** on, then select **Open log**. Clear **Pause** before
   reproducing the problem. New diagnostic lines contain `[P2P Diag]`;
   **Verbose Log** is not required for these lines.
5. Select **Replicate now** for the intended peer to test a manual round trip.
   Check **P2P Connection Request** prompts on both devices.
   For a problem with later automatic changes, first establish that the manual
   operation works, then make a small, non-private test edit on the source.
   Observe the receiving device as well as the source.
6. Record the last relevant messages and progress on both devices, then
   [collect a report](#collect-a-report) before restarting or retrying.

The summary continues updating with **Diag** off. **Diag** controls new detailed
output in the Log Pane; enabling it does not replay earlier hidden lines.
Diagnostic messages also enter the existing recent report history while
**Diag** is off. Opening the Log Pane displays messages already in its display
buffer. Repeated unchanged non-failure observations may be omitted, so the log
is not a record of every network message. **Pause** affects only the log display;
replication and the summary continue updating.

## Read the summary

Each row holds the latest recorded observation in one category on this device.
A new event from another peer can replace that row. Evidence can remain after
a peer leaves or a connection closes; use the peer identifier and timestamp
rather than reading the rows as a current connection-health checklist. The
summary is held in memory and does not preserve history across a restart.

| Row       | Examples                                                                                                        | What it establishes                                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Relay** | `Room opening`, `Room opened`, `Room could not open`, `Room closed`                                             | The local room lifecycle. `Room opened; relay replies not observed` does not prove that a relay accepted announcements, that a peer was discovered, or that a WebRTC data path works. |
| **Peer**  | `Peer advertised`, `Peer left`, `Authentication accepted`, `Authentication refused`, `Authentication timed out` | Discovery or the observed authentication outcome for the identified peer. A timeout means the request did not finish in time; it is not an explicit refusal.                          |
| **Sync**  | `Pull started`, `Pull completed`, `Watching peer changes`, `Announcing changes`, `Change notification received` | The latest observed pull, watch, announcement, or notification activity. A notification asks a peer to fetch; it does not itself carry Vault data.                                    |

- **Not observed** means no event has been recorded for that category. It does
  not mean success, failure, or a measured zero.
- **Unavailable** means the diagnostic capability is unavailable in the
  current implementation. Include the installed version in the report.
- `Authentication failed; authentication response not observed` and
  `Automatic watch skipped; peer announcement state not observed` identify an
  unavailable response, rather than claiming refusal or disabled announcements.
- Summary times are local observation times. `[P2P Diag]` lines also include an
  `observed` UTC timestamp. Account for device-clock differences when comparing
  reports. A timestamp is not a heartbeat or a continuously refreshed health check.

Relay rejection details are not available through this diagnostic summary.
Some existing RTC diagnostics also lack peer or room attribution and are not
assigned to a peer in these rows. **Stats** describes connection activity,
not transferred document or Vault file totals. If the summary cannot explain a
failure, preserve the logs and state what remains unobserved in the report.

## Understand transfer progress

| Indicator     | Meaning                                                                                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **↑ / ↓**     | Successfully sent or received database document revisions for the observed peer and direction, including both Metadata and Chunks. These are not counts of Vault files written. A new replication attempt starts new counts. |
| **⏩↑ / ⏩↓** | Changes-feed entries compared in that direction, including entries already held by the receiver. The count can advance while no revisions need transferring.                                                                 |
| **seq**       | A compatibility display of database sequence progress when document statistics are unavailable. Interpret it as a sequence value, not a document total or percentage.                                                        |

Each directional comparison label disappears three seconds after its count
last changes. Its disappearance does not establish that replication completed.
A zero transfer count can be normal when the receiver already has the data.

`Pull completed` records completion of a single database pull. It does not
establish that the reverse direction completed, that every peer has caught up,
or that every received revision has been reflected into a Vault file. Check
the test note on the receiving device. For missing files, follow
[the corresponding troubleshooting procedure](../troubleshooting.md#files-are-missing-or-excluded).

## Choose the next check

| Symptom or observation                                          | Next check                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The peer does not appear                                        | Capture the **Relay** and **Peer** rows, then check both devices' compatible versions, relay set, Group ID, and passphrase using [discovery checks](p2p-sync-tips.md#a-peer-does-not-appear). `Connected` alone is insufficient.                                                                                                             |
| Authentication is refused                                       | Confirm the peer identity and intended approval on both devices. The summary records the outcome; it does not grant approval.                                                                                                                                                                                                                |
| Authentication times out, or a peer appears but cannot transfer | Keep both devices visible and check for an unanswered **P2P Connection Request** before treating a timeout as a network failure. Compare their logs, then use the existing [WebRTC and TURN checks](p2p-sync-tips.md#a-peer-appears-but-synchronisation-cannot-connect) to investigate the data path.                                        |
| Manual replication works, but later edits do not arrive         | Confirm **Announce changes** on the source and **Follow changes** for that source on the receiver. Compare `Announcing changes`, `Watching peer changes`, and notification events on both devices. `Change notification ignored; peer is not watched` identifies a missing follow on the receiver.                                           |
| A pull remains the last observation                             | Compare its timestamp, ↑/↓ and ⏩ changes, and both devices' logs. Another operation may have replaced a summary row; an old `Pull started` or a hidden ⏩ label alone does not establish a stalled transfer. For a repeatable network-specific stall, use [message-size checks](p2p-sync-tips.md#a-connection-opens-but-a-transfer-stalls). |

After capturing the original symptom, **Disconnect** followed by
**Open connection** and **Replicate now** can test reconnection. Disconnecting
can cancel an active operation, so record whether a cancellation followed that
action. Reconnection, a changed message-size preset, or a different network
helps compare conditions; it does not identify or repair every underlying cause.

## Collect a report

Collect evidence from both the source and receiving devices around the same
attempt. Include:

- the plug-in or client version on each device, and which device originated the change;
- the **Diagnostic summary** rows and times, plus the surrounding `[P2P Diag]`
  lines and any other relevant errors;
- whether the peer appeared, whether manual **Replicate now** worked, and the
  observed ↑/↓, ⏩, or `seq` values;
- whether **Announce changes** and **Follow changes** were enabled, and whether
  either application was in the background or the device had been asleep; and
- the network types and whether TURN or a VPN was used, especially when the
  same devices work on one network but not another.

Run **Generate full report for opening the issue with debug info** before the
recent history is overwritten. It includes up to 1,000 recent log lines,
including verbose diagnostic messages even when **Verbose Log** is off.
For a problem which crosses a restart, follow the existing
[persistent logging procedure](../to_issue_reporting.md#a-problem-which-crosses-a-restart).

Review the complete report using the
[issue-reporting redaction guidance](../to_issue_reporting.md#full-livesync-report).
New `[P2P Diag]` messages use fixed descriptions and shortened peer identifiers,
but other log messages can still contain private information. Keep consistent
device aliases across the reports when replacing private identifiers.
