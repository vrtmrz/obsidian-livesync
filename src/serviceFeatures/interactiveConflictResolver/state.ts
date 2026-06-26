/**
 * State definitions for the Interactive Conflict Resolver feature.
 * This feature operates statelessly by invoking UI dialogue boxes,
 * and uses serialisation locks to prevent overlapping UI modals.
 */
export type ConflictResolverState = Record<string, never>;

export function createInitialState(): ConflictResolverState {
    return {};
}
