// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type DiagRTCPeerConnectionInternalStateHistory, type DiagRTCFailureDiagnosis, type DiagRTCPeerConnectionMetrics, type DiagRTCFailureStats } from "./DiagRTCPeerConnections.types";
/**
 * Diagnoses the failure reason of a failed RTCPeerConnection based on its internal state history and selected candidate pair information.
 * @param internalStateHistory The internal state history of the RTCPeerConnection.
 * @param selectedPair The selected candidate pair information.
 * @returns The diagnosis of the RTC failure.
 */
export declare function diagnoseRtcFailure(internalStateHistory: DiagRTCPeerConnectionInternalStateHistory, selectedPair: Record<string, unknown> | undefined): DiagRTCFailureDiagnosis;
/**
 * Describes the current progress of the RTCPeerConnection based on its internal state history and selected candidate pair information.
 *  This is useful for providing user-friendly status messages during the connection process.
 * @param internalStateHistory The internal state history of the RTCPeerConnection.
 * @param selectedPair The selected candidate pair information.
 * @returns A user-friendly description of the current connection progress.
 */
export declare function describeRTCProgress(internalStateHistory: DiagRTCPeerConnectionInternalStateHistory, selectedPair: Record<string, unknown> | undefined): string;
/**
 * Fetches the RTCPeerConnection statistics and returns a structured metrics object.
 * This is useful for diagnosing connection issues and understanding the connection performance.
 * @param instanceId An identifier for the RTCPeerConnection instance, used for logging.
 * @param peer The RTCPeerConnection instance to fetch stats from.
 * @returns A structured object containing the connection metrics, or undefined if fetching stats failed.
 */
export declare function getPeerConnectionStats(instanceId: string, peer: RTCPeerConnection): Promise<DiagRTCPeerConnectionMetrics | undefined>;
/**
 * Audits the RTCPeerConnection for failures and returns a structured failure report.
 * This is useful for diagnosing connection issues and understanding the reasons for failure.
 * @param instanceId An identifier for the RTCPeerConnection instance, used for logging.
 * @param internalStateHistory The internal state history of the RTCPeerConnection.
 * @param peer The RTCPeerConnection instance to audit.
 * @returns A structured object containing the failure diagnosis and metrics, or undefined if auditing failed.
 */
export declare function auditRtcConnectionFailures(instanceId: string, internalStateHistory: DiagRTCPeerConnectionInternalStateHistory, peer: RTCPeerConnection): Promise<DiagRTCFailureStats | undefined>;
