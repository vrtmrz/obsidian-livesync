// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { HashManagerCore } from "./HashManagerCore.ts";
import type { HashAlgorithm } from "@lib/common/models/setting.type.ts";
/**
 * Provides hash management using the "mixed-purejs" algorithm.
 *
 * This manager utilises a pure JavaScript implementation for hashing.
 * It is available only when the hash algorithm is set to "mixed-purejs".
 */
export declare class PureJSHashManager extends HashManagerCore {
    /**
     * Determines whether this manager is available for the specified algorithm.
     * @param hashAlg The hash algorithm to check.
     * @returns True if the algorithm is "mixed-purejs".
     */
    static isAvailableFor(hashAlg: HashAlgorithm): boolean;
    /**
     * Initialises the hash manager.
     * @returns Always resolves to true.
     */
    processInitialise(): Promise<boolean>;
    /**
     * Computes a hash for the given input, including encryption.
     * @param input The input string to hash.
     * @returns The computed hash as a promise.
     */
    computeHashWithEncryption(input: string): Promise<string>;
    /**
     * Computes a hash for the given input, without encryption.
     * @param input The input string to hash.
     * @returns The computed hash as a promise.
     */
    computeHashWithoutEncryption(input: string): Promise<string>;
}
/**
 * Provides hash management using the "sha1" algorithm.
 *
 * This manager utilises a pure JavaScript SHA-1 implementation.
 * It is available only when the hash algorithm is set to "sha1".
 */
export declare class SHA1HashManager extends HashManagerCore {
    /**
     * Determines whether this manager is available for the specified algorithm.
     * @param hashAlg The hash algorithm to check.
     * @returns True if the algorithm is "sha1".
     */
    static isAvailableFor(hashAlg: HashAlgorithm): boolean;
    /**
     * Initialises the hash manager.
     * @returns Always resolves to true.
     */
    processInitialise(): Promise<boolean>;
    /**
     * Computes a SHA-1 hash for the given input, including encryption.
     * @param input The input string to hash.
     * @returns The computed SHA-1 hash as a promise.
     */
    computeHashWithEncryption(input: string): Promise<string>;
    /**
     * Computes a SHA-1 hash for the given input, without encryption.
     * @param input The input string to hash.
     * @returns The computed SHA-1 hash as a promise.
     */
    computeHashWithoutEncryption(input: string): Promise<string>;
}
/**
 * Fallback hash manager using the pure JavaScript implementation.
 *
 * This manager is always available and acts as a fallback when no specific algorithm matches.
 */
export declare class FallbackPureJSHashManager extends PureJSHashManager {
    /**
     * Always returns true, indicating this manager is available for any algorithm.
     * @param _hashAlg The hash algorithm (ignored).
     * @returns True.
     */
    static isAvailableFor(_hashAlg: HashAlgorithm): boolean;
}
