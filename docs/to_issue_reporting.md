# How to report an issue

Thank you for helping improve Self-hosted LiveSync!

This document explains how to collect the information needed for an issue report. Issues with sufficient information will be prioritised.

---

## Filled example

Here is an example of a well-filled report for reference.

### Abstract

The synchronisation hung up immediately after connecting.

### Expected behaviour

- Synchronisation ends with the message `Replication completed`
- Everything synchronised

### Actually happened

- Synchronisation was cancelled with the message `TypeError: Failed to fetch` (visible in the plug-in log around lines 10–12)
- No files synchronised

### Reproducing procedure

1. Configure LiveSync with the settings shown in the attached report.
2. Click the sync button on the ribbon.
3. Synchronisation begins.
4. About two or three seconds later, the error `TypeError: Failed to fetch` appears.
5. Replication stops. No files synchronised.

### Obsidian debug info (Device 1 — Windows desktop)

```
SYSTEM INFO:
	Obsidian version: v1.2.8
	Installer version: v1.1.15
	Operating system: Windows 10 Pro 10.0.19044
	Login status: logged in
	Catalyst license: supporter
	Insider build toggle: off
	Community theme: Minimal v6.1.11
	Snippets enabled: 3
	Restricted mode: off
	Plugins installed: 35
	Plugins enabled: 11
		1: Self-hosted LiveSync v0.19.4
		...
```

### Report from LiveSync

```
----remote config----
cors:
  credentials: "true"
  ...
---- Plug-in config ---
couchDB_URI: self-hosted
couchDB_USER: 𝑅𝐸𝐷𝐴𝐶𝑇𝐸𝐷
...
```

### Plug-in log

```
2023/5/24 10:50:33->HTTP:GET to:/ -> failed
2023/5/24 10:50:33->TypeError:Failed to fetch
2023/5/24 10:50:33->could not connect to https://example.com/ : your vault
(TypeError:Failed to fetch)
```

---

## How to collect each piece of information

### Obsidian debug info

Open the command palette (`Ctrl/Cmd + P`) and run **"Show debug info"**. Copy the output and paste it into the issue.

If multiple devices are involved in the problem (e.g., sync between a phone and a desktop), please provide the debug info for each device. The device where the issue occurred is required; information from other devices is strongly recommended.

### Report from LiveSync (hatch report)

1. Open LiveSync settings.
2. Go to the **Hatch** pane.
3. Press the **Make report** button.

The report will be copied to your clipboard. It contains your LiveSync configuration and the remote server configuration, with credentials automatically redacted.

**Tip:** For large reports, consider uploading to [GitHub Gist](https://gist.github.com/) and sharing the link instead of pasting directly into the issue. This makes it easier to manage, and if you accidentally leave sensitive data in, a Gist can be deleted.

If you paste directly, wrap it in a `<details>` tag to keep the issue readable:

```
<details>
<summary>Report from hatch</summary>

```
----remote config----
  :
```
</details>
```

### Plug-in log

The plug-in log is volatile by default (not saved to disk) and shown only in the log dialogue, which can be opened by tapping the **document box icon** in the ribbon.

#### Enable verbose log

Before reproducing the issue, enable **Verbose Log** in LiveSync's **General Settings** pane. Without this, many diagnostic messages will be suppressed.

#### Persist the log to a file (optional)

If you need to capture a log across a restart, enable **"Write logs into the file"** in General Settings. Note that log files may contain sensitive information — use this option only for troubleshooting, and disable it afterwards.

As with the hatch report, consider uploading large logs to [GitHub Gist](https://gist.github.com/).

### Network log (for connection-related issues only)

If the issue is related to network connectivity (e.g., cannot connect to the server, authentication errors), a network log captured from browser DevTools can be very helpful. You do not need to include this for non-connection issues.

#### Opening DevTools

| Platform | Shortcut |
|----------|----------|
| Windows / Linux | `Ctrl + Shift + I` |
| macOS | `Cmd + Shift + I` |
| Android | Use [Chrome remote debugging](https://developer.chrome.com/docs/devtools/remote-debugging/) |
| iOS | Use [Safari Web Inspector](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios) on a Mac |

#### What to capture

1. Open the **Network** pane in DevTools.
2. Reproduce the issue.
3. Look for requests marked in red.
4. Capture screenshots of the **Headers**, **Payload**, and **Response** tabs for those requests.

**Important — redact before sharing:**
- Headers: conceal the request URL path, Remote Address, `authority`, and `authorisation` values.
- Payload / Response: the `_id` field contains your file paths — redact if needed.
