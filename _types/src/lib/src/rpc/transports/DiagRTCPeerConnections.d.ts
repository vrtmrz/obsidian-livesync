// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { DiagRTCStats, DiagRTCFailureDiagnosis } from "./DiagRTCPeerConnections.types";
/**
 * Subscribes to connection status updates. The callback will be called with the latest connection statistics whenever there is a change in the connection status of any RTCPeerConnection instance.
 * Returns an unsubscribe function to stop receiving updates.
 *
 * @param callback - The function to call with the latest connection statistics.
 * @returns A function that can be called to unsubscribe from updates.
 */
export declare function subscribeConnectionStatus(callback: (status: DiagRTCStats) => void): () => void;
/**
 * Subscribes to failure diagnosis updates. The callback will be called with the diagnosis information whenever a connection failure is detected in any RTCPeerConnection instance.
 * Returns an unsubscribe function to stop receiving updates.
 * @param callback - The function to call with the diagnosis information.
 * @returns A function that can be called to unsubscribe from updates.
 */
export declare function subscribeFailureDiagnosis(callback: (diagnosis: DiagRTCFailureDiagnosis) => void): () => void;
export type DiagRTCPeerConnectionConstructor = typeof RTCPeerConnection;
/**
 * A wrapper around RTCPeerConnection to collect statistics for diagnostics.
 * It extends the native (or globally-polyfilled) RTCPeerConnection and overrides its constructor to add event listeners for connection state changes,
 * ice connection state changes, ice gathering state changes, and signaling state changes. It maintains a history of these states and logs the progress.
 * It also tracks the number of new connections, failed connections, successful connections, and closed connections, and dispatches this information to subscribers.
 */
export declare function createDiagRTCPeerConnectionConstructor(): DiagRTCPeerConnectionConstructor;
