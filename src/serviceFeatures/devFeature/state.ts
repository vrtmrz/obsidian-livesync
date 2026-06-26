import { writable, type Writable } from "svelte/store";

/**
 * Interface representing the state of the dev feature, including test results.
 */
export interface DevFeatureState {
    testResults: Writable<[boolean, string, string][]>;
}

/**
 * Creates the initial state object.
 */
export function createInitialState(): DevFeatureState {
    return {
        testResults: writable<[boolean, string, string][]>([]),
    };
}
