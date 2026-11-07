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
3. In the **P2P Status** pane, expand **Diagnostic summary** below **Stats**.
   It starts collapsed. Record all three rows and their observation times before
   changing connection or database settings.
4. Turn the **Diag** toggle on in the **P2P Status** card, then select
   **Open log** inside the expanded summary. In the opened Log Pane, ensure
   **Pause** is cleared before reproducing the problem. New diagnostic lines
   contain `[P2P Diag]`; **Verbose Log** is not required for these lines.
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
| **Relay** | `Room opening`, `Room opened`, `Room could not open`, `Room closed`                                             | The local room lifecycle. 'Room opened; relay replies not observed' records local room opening. Relay acceptance remains unobserved; use later peer and sync observations to investigate discovery and data transfer. |
| **Peer**  | `Peer advertised`, `Peer left`, `Authentication accepted`, `Authentication refused`, `Authentication timed out` | Discovery or the observed authentication outcome for the identified peer. A timeout indicates that the request exceeded its time limit, rather than an explicit rejection.                                                                    |
| **Sync**  | `Pull started`, `Pull completed`, `Watching peer changes`, `Announcing changes`, `Change notification received` | The latest observed pull, watch, announcement, or notification activity. Note that notifications signal a peer to fetch changes, rather than carrying Vault data directly.                                                                   |

- **Not observed** indicates that no event has been recorded yet for that
  category, rather than confirming success, failure, or a zero count.
- **Unavailable** means the diagnostic capability is unavailable in the
  current implementation. Include the installed version in the report.
- `Authentication failed; authentication response not observed` and
  `Automatic watch skipped; peer announcement state not observed` identify an
  unavailable response, rather than claiming refusal or disabled announcements.
- Summary times are local observation times, while `[P2P Diag]` lines include an
  `observed` UTC timestamp. Consider any device-clock differences when comparing
  reports across devices. Timestamps record when this device observed an event;
  they are not an ongoing heartbeat or live health check.

Relay rejection details are not provided by this diagnostic summary.
Some existing RTC diagnostics also lack peer or room attribution and are not
assigned to individual peers in these rows. **Stats** describes connection activity,
whereas transferred document totals appear in transfer progress. If the summary
cannot fully identify a failure, preserve the log output and note any unobserved
categories in your report.

## Understand transfer progress

During synchronisation, transfer counters appear next to each peer in the
P2P Status pane, in the editor status bar, and in the main status bar when
P2P is the active synchronisation method.

| Indicator     | Meaning                                                                                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **↑ / ↓**     | Successfully sent or received database document revisions for the observed peer and direction, including both Metadata and Chunks. These are not counts of Vault files written. A new replication attempt starts new counts. |
| **⏩↑ / ⏩↓** | Changes-feed entries compared in that direction, including entries already held by the receiver. The count can advance while no revisions need transferring.                                                                 |
| **seq**       | A compatibility display of database sequence progress when document statistics are unavailable. Interpret it as a sequence value, not a document total or percentage.                                                        |

Each directional comparison label disappears three seconds after its count
last changes. A hidden label alone does not establish whether comparison or
replication has finished. A zero transfer count can be normal when the receiver
already has the data.

`Pull completed` confirms that a single database pull has finished. To verify
bidirectional synchronisation and full reflection, ensure the reverse direction
completes and check the updated notes on the receiving device. For missing files,
follow
[the corresponding troubleshooting procedure](../troubleshooting.md#files-are-missing-or-excluded).

## Choose the next check

| Symptom or observation                                          | Next check                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The peer does not appear                                        | Capture the **Relay** and **Peer** rows, then verify both devices' compatible versions, relay set, Group ID, and passphrase using [discovery checks](p2p-sync-tips.md#a-peer-does-not-appear). A `Connected` status indicates that the local room is open; relay replies remain unobserved. Use peer and sync observations and both devices' logs to investigate discovery and transfer.           |
| Authentication is refused                                       | Confirm the peer identity on both devices and check for pending approval prompts. The summary displays the observed outcome; please ensure the connection request is explicitly accepted on the receiving device.                                                                                                                         |
| Authentication times out, or a peer appears but cannot transfer | Keep both devices active and check for an unanswered **P2P Connection Request** before troubleshooting network connectivity. Compare logs between devices, then follow existing [WebRTC and TURN checks](p2p-sync-tips.md#a-peer-appears-but-synchronisation-cannot-connect) to inspect the data path.                                        |
| Manual replication works, but later edits do not arrive         | Confirm **Announce changes** on the source and **Follow changes** for that source on the receiver. Compare `Announcing changes`, `Watching peer changes`, and notification events on both devices. `Change notification ignored; peer is not watched` identifies a missing follow on the receiver.                                           |
| A pull remains the last observation                             | Compare its timestamp, ↑/↓ and ⏩ changes, and both devices' logs. A subsequent operation may have replaced the summary row; verify with the surrounding logs and transfer counters to confirm whether a transfer is truly stalled. For a repeatable network-specific stall, use [message-size checks](p2p-sync-tips.md#a-connection-opens-but-a-transfer-stalls). |

After capturing the initial symptom, selecting **Disconnect** followed by
**Open connection** and **Replicate now** can test reconnection. Because
disconnecting cancels active operations, record whether a cancellation occurred.
Testing reconnection, adjusting the message-size preset, or trying an
alternative network can help isolate environmental differences.

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
