# How to report an issue

Thank you for helping improve Self-hosted LiveSync. A concise report with the right evidence is more useful than trying several recovery operations before reporting the original symptom.

Use the [issue report template](https://github.com/vrtmrz/obsidian-livesync/issues/new?template=issue-report.md) for the report itself. Use [Troubleshooting](troubleshooting.md) to diagnose a symptom or choose a recovery action.

If a maintainer requests additional evidence, follow the relevant procedure below. These reports supplement the required information in this guide.

| Requested evidence                                                    | Procedure                             |
| --------------------------------------------------------------------- | ------------------------------------- |
| Database integrity, current conflicts, or differences between sources | [Integrity report](#integrity-report) |
| Local revision and Chunk usage                                        | [Usage report](#usage-report)         |
| More information about a path pseudonym in an existing report         | [File follow-up](#file-follow-up)     |

Maintainers can link directly to each procedure and adapt the [example requests](#requesting-diagnostics).

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

### A problem involving database integrity or usage

Follow the [Integrity report](#integrity-report) procedure for database-wide consistency findings, or the [Usage report](#usage-report) procedure for local revision and Chunk accounting. [Collect a report](troubleshooting.md#collect-a-report) explains the inspection limits and how to read the results.

### A problem involving one file

Run `Copy database information for the active file`, or use **Hatch** → **Copy database information for a file** to select another file.

This report describes only the local database on that device. It includes the Vault-relative path, document and chunk identifiers, local revisions, conflicts, and local chunk availability. It does not query the remote or include file contents. Review paths and identifiers as private metadata before sharing them.

If the request identifies a path pseudonym from an existing report, use [File follow-up](#file-follow-up) to retain that report's pseudonyms.

### A problem which crosses a restart

Use `Write logs into the file` under **Hatch** only when the in-memory report cannot cover the restart. Persistent logging affects performance and can record private information. Disable it after reproducing the problem, review the log before sharing it, and remove the log file when it is no longer needed.

### A connection, authentication, or CORS problem

Include network evidence only when the ordinary LiveSync log cannot show the rejected response. Follow [Inspect a network failure](troubleshooting.md#inspect-a-network-failure), and remove request paths, remote addresses, authority and authorisation values, cookies, credentials, payload identifiers, and response secrets before sharing screenshots or copied data.

## Requested diagnostic reports

Use the device and Vault named in the request. Label each result with a device role such as 'Device A: edits originate here', and include when it was collected. If an action below is unavailable, report the installed plug-in version and the missing action.

These reporting tools inspect existing state without repairing or resetting it. Preserve the original symptom as described above.

### Integrity report

1. Open Self-hosted LiveSync settings → **Hatch** → **Reporting Tools** → **Inspect database integrity**, then select **Inspect**.
2. Keep **Pseudonyms (recommended)** selected.
3. Leave **Include remote database** selected unless the request specifies a local-only inspection. For a local-only inspection, clear it. This controls diagnostic requests for this run; it does not change normal synchronisation settings.
4. Select **Begin inspection**. If you cancel, retain the resulting report and its cancellation status.
5. Choose **MARKDOWN**, then **Copy report** or **Save report**. Share the complete output after reviewing it. Use **JSON** instead if the maintainer requests it.

Keep the status, versions, settings, scope, coverage, counts, findings, and errors together. A partial or cancelled result is useful evidence. If the report is too large for a comment, share the saved report or a reviewed Gist, and identify its device role in the issue.

The remote inspection currently supports CouchDB. An excluded or unavailable remote remains visible in the report; changing remote settings is not part of this procedure. Content checks cover suspect groups, so `not-checked` is meaningful. A completed inspection does not establish that every file is healthy. See [Read the compact Markdown integrity report](troubleshooting.md#read-the-compact-markdown-integrity-report) for the state notation and Review index.

### Usage report

1. Open Self-hosted LiveSync settings → **Hatch** → **Reporting Tools** → **Analyse database usage**, then select **Analyse**.
2. Keep **Pseudonyms (recommended)** selected, then select **Begin inspection**.
3. For a complete result, choose **TSV**, unless the maintainer requests **JSON**. Partial or cancelled results use **JSON** to retain their status and reasons.
4. Select **Copy report** or **Save report**, review the output, and share it with the device role and collection time.

This analysis reads the local database. Its revision-reading total can grow during discovery, followed by a separate accounting stage. Reported sizes describe stored string units and do not measure the physical database file. Cancelling during accounting omits unfinished statistics.

### File follow-up

Use this procedure when a maintainer identifies a path token from an Integrity or Usage report. The complete token has the form `<salt>$<hash>`. Copy the token itself, including the salt and `$`, without surrounding Markdown backticks. An observation reference such as `local:12` or `remote:12`, a document pseudonym, or a revision pseudonym is not a path token.

1. On the requested device, open Self-hosted LiveSync settings → **Hatch** → **Reporting Tools** → **Find a file from a report pseudonym**, then select **Find file**.
2. Paste the complete token into **Report path pseudonym**, then select **Find file** in the dialogue.
3. For a matching candidate, select **Prepare follow-up report**.
4. Choose **MARKDOWN** or **JSON**, then **Copy report** or **Save report**. Review the generated output before sharing it, and identify the original report, token, and device role.
5. If several candidates match the path, use **Back to matches** and prepare a separate report for each, unless the maintainer has specified a particular candidate. Keep the reports separate so their document IDs can be compared.

Use the token from the original request throughout. The follow-up reuses its salt, which keeps pseudonyms comparable with the original report. A new database-wide report generates a new salt, so its pseudonyms will differ.

The candidate list displays real paths and document IDs locally. Share the generated pseudonymised report rather than a screenshot of that list. A Metadata candidate can still be inspected when its current Vault file is missing. A Vault-only candidate reports that local Metadata was not inspected.

If there are no matches, report that outcome and the device role. The lookup searches current Vault paths and current local normal-file Metadata; it does not search the remote or older history. A rename, deletion, or remote-only path can therefore have no local match. An older ordinal pseudonym cannot be used for this lookup.

The follow-up report inspects the selected local document, current conflicts, and selected merge bases, and lists available revision-history status. It omits file contents and credentials, does not query the remote, and does not scan every historical file body. Pseudonyms use a public salt, so someone with the report can test guessed paths against a token.

## Sharing the report

Paste reports into the matching collapsible sections in the issue template, or provide a link to an already-redacted Gist. A separate plug-in log is normally unnecessary because the full LiveSync report already contains the recent verbose log history.

Integrity and file follow-up Markdown already include a collapsible section and a code block. Paste that output directly into an issue comment, outside any existing code block. Keep each device's report separate, and preserve the original token when adding a follow-up.

If a maintainer asks for a more specialised diagnostic, collect only that additional evidence and review it again before publishing it.

## Requesting diagnostics

For maintainers: choose the procedure which answers the current question, specify the device role, and replace the placeholders before posting a request. The examples use direct links to the relevant steps. For Integrity, choose one remote setting explicitly; inclusion is the default. If the requested action requires a newer build, identify the version to use.

### Request an integrity report

```markdown
Would you be willing to collect an [Integrity report](https://github.com/vrtmrz/obsidian-livesync/blob/main/docs/to_issue_reporting.md#integrity-report) on **[DEVICE ROLE]**, using **Pseudonyms (recommended)** with **Include remote database [selected / cleared]**?

Please share the complete Markdown output after reviewing it, including its status, scope, coverage, and errors. A partial or cancelled result is useful too. Include the device role and collection time.
```

### Request a usage report

```markdown
Would you be willing to collect a [Usage report](https://github.com/vrtmrz/obsidian-livesync/blob/main/docs/to_issue_reporting.md#usage-report) on **[DEVICE ROLE]**, using **Pseudonyms (recommended)**?

Please share the reviewed TSV output for a complete result, or JSON for a partial or cancelled result, with the device role and collection time.
```

### Request a file follow-up

Include the original report link or label, its observation reference where available, and the complete path token. Keep the revision generation and document pseudonym available when discussing a particular branch. A reference such as `remote:12` locates an observation within that report; the path token is what the user enters into the lookup.

```markdown
Would you be willing to follow the [File follow-up steps](https://github.com/vrtmrz/obsidian-livesync/blob/main/docs/to_issue_reporting.md#file-follow-up) on **[DEVICE ROLE]** for this entry?

- Original report: [REPORT LINK OR LABEL]
- Observation: `[REFERENCE, IF AVAILABLE]`
- Path token: `[COMPLETE SALT$HASH TOKEN]`

Please share the generated pseudonymised Markdown or JSON report. If several candidates match, share a separate report for each. If none match, tell us that outcome. Include the device role and collection time; the generated reports are sufficient without sharing real paths or a screenshot of the candidate list.
```
