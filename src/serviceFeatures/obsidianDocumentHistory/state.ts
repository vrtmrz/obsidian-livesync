/**
 * State definitions for the Obsidian Document History feature.
 * Operates statelessly by spawning modals as requested.
 */
export type DocumentHistoryState = Record<string, never>;

export function createInitialState(): DocumentHistoryState {
    return {};
}
