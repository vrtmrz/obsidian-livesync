# How to report an issue

Thank you for helping improve Self-hosted LiveSync. A concise report with the right evidence is more useful than trying several recovery operations before reporting the original symptom.

Use the [issue report template](https://github.com/vrtmrz/obsidian-livesync/issues/new?template=issue-report.md) for the report itself. Use [Troubleshooting](troubleshooting.md) to diagnose a symptom or choose a recovery action.

## Preserve the original symptom

Do not reset a database, rebuild a remote, change transport, or enable P2P merely to see whether the problem disappears. These actions can change the evidence and may make the original cause harder to identify.

If the problem may involve data loss, corruption, or unexpected deletion, preserve a copy of every readable affected file and stop editing it on other devices before changing settings.

Include when the problem began, whether it followed an update or restart, how often it occurs, and which device and remote type were involved.

## Required information

### Describe the behaviour

Complete the issue template with:

- a one- or two-sentence summary;
- the expected and actual behaviour;
- repeatable steps, or the frequency and timing when reliable reproduction is not available; and
- the role of each relevant device, such as the device where the change originated and the device where the failure appeared.

### Obsidian debug information

Open the command palette with `Ctrl`+`P` or `Command`+`P`, run `Show debug info`, and include its output for each relevant device. The device where the problem appeared is required. Information from the other participating devices is particularly useful for synchronisation problems.

### Full LiveSync report

Run `Generate full report for opening the issue with debug info` on the device where the problem appeared. For a synchronisation problem, also collect a report from another participating device when its settings or logs are relevant. The command copies the current LiveSync settings summary and up to 1,000 recent log lines. It collects verbose log lines even when `Verbose Log` is disabled, so you do not need to enable that setting before reproducing the problem.

The command automatically redacts known credential fields in the settings summary. It cannot guarantee that private text in log messages or unrecognised configuration fields is removed. Review the complete output before sharing it. Remove or replace:

- usernames, passwords, passphrases, tokens, keys, and custom headers;
- private server URLs, network addresses, database names, bucket names, room identifiers, and relay details;
- Vault names, device names, and file paths; and
- file contents or other private text which appears in a log message.

Document and chunk identifiers can also be private metadata, but they may be necessary for diagnosing file reconstruction and chunk availability. Decide deliberately whether to share them. If you remove them, state that the report was redacted and that this may limit the diagnosis.

For a large report, you may share a GitHub Gist after reviewing and redacting it. Deleting a Gist later cannot undo information which has already been disclosed.

## Additional evidence when relevant

### A problem involving one file

Run `Copy database information for the active file`, or use **Hatch** → **Copy database information for a file** to select another file.

This report describes only the local database on that device. It includes the Vault-relative path, document and chunk identifiers, local revisions, conflicts, and local chunk availability. It does not query the remote or include file contents. Review paths and identifiers as private metadata before sharing them.

### A problem which crosses a restart

Use `Write logs into the file` under **Hatch** only when the in-memory report cannot cover the restart. Persistent logging affects performance and can record private information. Disable it after reproducing the problem, review the log before sharing it, and remove the log file when it is no longer needed.

### A connection, authentication, or CORS problem

Include network evidence only when the ordinary LiveSync log cannot show the rejected response. Follow [Inspect a network failure](troubleshooting.md#inspect-a-network-failure), and remove request paths, remote addresses, authority and authorisation values, cookies, credentials, payload identifiers, and response secrets before sharing screenshots or copied data.

## Sharing the report

Paste reports into the matching collapsible sections in the issue template, or provide a link to an already-redacted Gist. A separate plug-in log is normally unnecessary because the full LiveSync report already contains the recent verbose log history.

If a maintainer asks for a more specialised diagnostic, collect only that additional evidence and review it again before publishing it.
