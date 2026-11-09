/** Decoded database fields inspected by the plain-text local retry scenarios. */
export interface DatabaseTextObservation {
    /** Metadata type reported by the loaded revision. */
    readonly type?: unknown;
    /** Content datatype reported by the database reader. */
    readonly datatype?: unknown;
    /** Concatenated revision content, before any encoding assumption. */
    readonly body?: unknown;
}

/**
 * Match the exact text and representation required by the Markdown fixtures.
 * @param observation - The loaded database branch, or an unavailable observation.
 * @param expected - Exact text expected from the corresponding Vault file.
 * @returns True only for plain Metadata and plain content with exactly the expected text.
 * @remarks This closure-free function is also serialised into the isolated Obsidian evaluation.
 * Base64 characters stored as plain text are different bytes, even when they encode the expected text.
 */
export function matchesPlainDatabaseText(
    observation: DatabaseTextObservation | null | undefined,
    expected: string
): boolean {
    return observation?.type === "plain" && observation.datatype === "plain" && observation.body === expected;
}
