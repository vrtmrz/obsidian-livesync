// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { type Writable } from "svelte/store";
/**
 * Interface representing the state of the dev feature, including test results.
 */
export interface DevFeatureState {
    testResults: Writable<[boolean, string, string][]>;
}
/**
 * Creates the initial state object.
 */
export declare function createInitialState(): DevFeatureState;
