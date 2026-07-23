/**
 * Canonical English for LiveSync-owned messages whose wording is still being
 * exercised. These keys remain application-owned and must not be added to
 * Commonlib merely to make them available to the LiveSync translator.
 *
 * Move a message to the YAML catalogue when it is ready for translation, and
 * remove it from this map in the same change.
 */
export const liveSyncProvisionalEnglishMessages = {
    "This file has unresolved conflicts.": "This file has unresolved conflicts.",
    "This file has ${COUNT} unresolved versions. They will be reviewed one pair at a time.":
        "This file has ${COUNT} unresolved versions. They will be reviewed one pair at a time.",
} as const;

export type LiveSyncProvisionalMessageKey = keyof typeof liveSyncProvisionalEnglishMessages;
