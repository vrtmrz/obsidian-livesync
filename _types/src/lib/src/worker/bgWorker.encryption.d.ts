// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type EncryptHKDFProcessItem, type ResultPayload } from "./universalTypes.ts";
import { type EncryptProcessItem } from "./universalTypes.ts";
import { type EncryptHKDFArguments } from "./universalTypes.ts";
import { type EncryptArguments } from "./universalTypes.ts";
/**
 * Offloads encryption to a web worker.
 * @param data The data to be encrypted.
 * @returns A promise that resolves with the encryption result.
 */
export declare function encryptionOnWorker(data: Omit<EncryptArguments, "key">): Promise<string>;
/**
 * Offloads HKDF encryption to a web worker.
 * @param data The data to be encrypted.
 * @returns A promise that resolves with the encryption result.
 */
export declare function encryptionHKDFOnWorker(data: Omit<EncryptHKDFArguments, "key">): Promise<string>;
/**
 * Handles the encryption callbacks
 * @param process The process item associated with the task.
 * @param data The data to be processed.
 */
export declare function handleTaskEncrypt(process: EncryptProcessItem | EncryptHKDFProcessItem, data: ResultPayload): void;
