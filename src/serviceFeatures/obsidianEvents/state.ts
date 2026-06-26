import { type ReactiveSource } from "octagonal-wheels/dataobject/reactive";

/**
 * Represents the runtime state of the Obsidian events module.
 */
export interface ObsidianEventsState {
    initialCallback: (() => void) | undefined;
    hasFocus: boolean;
    isLastHidden: boolean;
    totalProcessingCount: ReactiveSource<number> | undefined;
}

/**
 * Creates and initialises a new Obsidian events state object.
 *
 * @returns A freshly initialised {@link ObsidianEventsState} object.
 */
export function createObsidianEventsState(): ObsidianEventsState {
    return {
        initialCallback: undefined,
        hasFocus: true,
        isLastHidden: false,
        totalProcessingCount: undefined,
    };
}
