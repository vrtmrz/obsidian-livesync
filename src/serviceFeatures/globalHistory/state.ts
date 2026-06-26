/**
 * State definitions for the Global History feature.
 * Operates statelessly.
 */
export type GlobalHistoryState = Record<string, never>;

export function createInitialState(): GlobalHistoryState {
    return {};
}
