import type { CompatibilityPause, CompatibilityPauseReason } from "@/common/databaseCompatibility.ts";

export function compatibilityReviewSummaryMarkdown(pause: CompatibilityPause): string {
    const action = pause.resumable
        ? "Before resuming, review the compatibility details and update Self-hosted LiveSync on every device which uses this remote database."
        : "This installation cannot safely acknowledge the detected state. Update Self-hosted LiveSync before attempting to synchronise again.";
    return `Remote synchronisation is paused on this device because its compatibility state requires attention.

${action}

Your automatic synchronisation preferences have not been changed. Closing this dialogue keeps synchronisation paused.`;
}

function reasonMarkdown(reason: CompatibilityPauseReason): string {
    if (reason.source === "database-version") {
        if (reason.state === "upgrade") {
            return `- The last acknowledged internal database version was **${reason.acknowledgedVersion}** and this installation uses **${reason.currentVersion}**.`;
        }
        if (reason.state === "downgrade") {
            return `- This installation uses internal database version **${reason.currentVersion}**, but this device previously acknowledged newer version **${reason.acknowledgedVersion}**. An older installation must not resume synchronisation.`;
        }
        if (reason.state === "missing") {
            return `- No previously acknowledged internal database version was found for this existing Vault. This can happen when a Vault is copied or restored, or when it is opened with a new Obsidian profile. This installation uses version **${reason.currentVersion}**. An empty local database does not mean that it is safe to resume automatically.`;
        }
        return `- The saved internal database version marker is invalid. This installation uses version **${reason.currentVersion}**.`;
    }
    if (reason.source === "settings-schema") {
        if (reason.isFromFutureSchema) {
            return `- The saved settings use schema **${reason.sourceVersion}**, which is newer than schema **${reason.currentVersion}** supported by this installation.`;
        }
        return `- The settings were migrated from schema **${reason.sourceVersion}** to **${reason.currentVersion}** and require review before synchronisation resumes.`;
    }
    const escapedMessage = reason.message.replace(/[\\`*_{}[\]()<>#+.!|-]/gu, "\\$&");
    return `- An earlier compatibility review remains pending: ${escapedMessage}`;
}

export function compatibilityReviewDetailsMarkdown(pause: CompatibilityPause): string {
    const resolution = pause.resumable
        ? "After all devices have been updated, return to the compatibility review summary and explicitly resume synchronisation. The current internal version will only then be recorded as acknowledged."
        : "Install a compatible current version of Self-hosted LiveSync. This pause cannot be dismissed by the current installation.";
    return `## Why synchronisation is paused

${pause.reasons.map(reasonMarkdown).join("\n")}

## What the pause changes

- Remote replication is blocked before work begins.
- Your saved automatic synchronisation preferences remain unchanged.
- Closing either dialogue leaves the safety gate active.

## What to do next

${resolution}`;
}
