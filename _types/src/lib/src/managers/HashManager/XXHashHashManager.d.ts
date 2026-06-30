// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { HashManagerCore, type HashManagerCoreOptions } from "./HashManagerCore.ts";
import type { XXHashAPI } from "xxhash-wasm-102";
import type { HashAlgorithm } from "@lib/common/models/setting.type.ts";
/**
 * Abstract base class for hash managers using XXHash algorithms.
 * Provides initialisation and common properties for XXHash-based managers.
 */
export declare abstract class XXHashHashManager extends HashManagerCore {
    /**
     * Instance of XXHash API used for hashing operations.
     */
    xxhash: XXHashAPI;
    /**
     * Constructs a new XXHashHashManager.
     * @param options - Options for the hash manager core.
     */
    constructor(options: HashManagerCoreOptions);
    /**
     * Initialises the XXHash API instance.
     * @returns A promise resolving to true when initialisation is complete.
     */
    processInitialise(): Promise<boolean>;
}
/**
 * Hash manager for the legacy hash algorithm (empty string).
 * Utilises XXHash32 raw hashing.
 */
export declare class XXHash32RawHashManager extends XXHashHashManager {
    /**
     * Determines whether this manager is available for the specified algorithm.
     * @param hashAlg - The hash algorithm to check.
     * @returns True if available, false otherwise.
     */
    static isAvailableFor(hashAlg: HashAlgorithm): boolean;
    /**
     * Computes a hash for the given piece using encryption.
     * @param piece - The input string to hash.
     * @returns A promise resolving to the hash string.
     */
    computeHashWithEncryption(piece: string): Promise<string>;
    /**
     * Computes a hash for the given piece without encryption.
     * @param piece - The input string to hash.
     * @returns A promise resolving to the hash string.
     */
    computeHashWithoutEncryption(piece: string): Promise<string>;
}
/**
 * Hash manager for the XXHash64 algorithm ("xxhash64").
 */
export declare class XXHash64HashManager extends XXHashHashManager {
    /**
     * Determines whether this manager is available for the specified algorithm.
     * @param hashAlg - The hash algorithm to check.
     * @returns True if available, false otherwise.
     */
    static isAvailableFor(hashAlg: HashAlgorithm): boolean;
    /**
     * Computes a hash for the given piece using encryption.
     * @param piece - The input string to hash.
     * @returns A promise resolving to the hash string.
     */
    computeHashWithEncryption(piece: string): Promise<string>;
    /**
     * Computes a hash for the given piece without encryption.
     * @param piece - The input string to hash.
     * @returns A promise resolving to the hash string.
     */
    computeHashWithoutEncryption(piece: string): Promise<string>;
}
/**
 * Fallback hash manager utilising XXHash32.
 * Used when no specific algorithm is matched.
 * Please be careful with this manager, as it is different from XXHash32RawHashManager.
 */
export declare class FallbackWasmHashManager extends XXHashHashManager {
    /**
     * Determines whether this manager is available for the specified algorithm.
     * Always returns true as a fallback.
     * @param hashAlg - The hash algorithm to check.
     * @returns True.
     */
    static isAvailableFor(hashAlg: HashAlgorithm): boolean;
    /**
     * Computes a hash for the given piece using encryption.
     * @param piece - The input string to hash.
     * @returns A promise resolving to the hash string.
     */
    computeHashWithEncryption(piece: string): Promise<string>;
    /**
     * Computes a hash for the given piece without encryption.
     * @param piece - The input string to hash.
     * @returns A promise resolving to the hash string.
     */
    computeHashWithoutEncryption(piece: string): Promise<string>;
}
