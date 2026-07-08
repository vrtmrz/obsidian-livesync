// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type ResultPayloadWithSeq, type SplitProcessItem } from "./universalTypes";
/**
 * Splits data into pieces using a worker.
 * @param dataSrc The source data to be split.
 * @param pieceSize The size of each piece.
 * @param plainSplit Whether to use plain splitting.
 * @param minimumChunkSize The minimum size of each chunk.
 * @param filename The name of the file being processed.
 * @param splitVersion The version of the splitting algorithm to use.
 * @param useSegmenter Whether to use a segmenter (only works on splitVersion:2)
 * @returns A generator that yields the split pieces.
 */
export declare function _splitPieces2Worker(dataSrc: Blob, pieceSize: number, plainSplit: boolean, minimumChunkSize: number, filename: string | undefined, splitVersion: 1 | 2 | 3, useSegmenter: boolean): () => AsyncGenerator<string, void, unknown>;
/**
 * Aborts all in-flight split tasks identified by the given keys.
 * Called when the background worker that owned these tasks has crashed, so the streams
 * will never receive any more data and must be torn down to unblock callers.
 * @param keys The task keys to abort.
 * @param error The error to report to each stream.
 */
export declare function abortSplitTasks(keys: number[], error: Error): void;
/**
 * Handles the splitting callback from the worker.
 * @param process the splitting process item
 * @param data the data received from the worker
 */
export declare function handleTaskSplit(process: SplitProcessItem, data: ResultPayloadWithSeq): void;
