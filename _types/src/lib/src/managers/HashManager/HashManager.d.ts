// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { HashAlgorithm } from "@lib/common/models/setting.type.ts";
import { HashManagerCore, type HashManagerCoreOptions } from "./HashManagerCore.ts";
/**
 * Class for managing hash managers and performing hash calculations.
 * Selects an appropriate manager according to the available hash algorithm.
 */
export declare class HashManager extends HashManagerCore {
    /**
     * Instance of the hash manager currently in use.
     */
    manager: HashManagerCore;
    /**
     * Checks whether the specified hash algorithm is available.
     *
     * @param hashAlg The hash algorithm to check
     * @returns True if available
     */
    static isAvailableFor(hashAlg: HashAlgorithm): boolean;
    /**
     * Selects and initialises an available hash manager.
     *
     * @returns True if initialisation is successful
     * @throws Throws an error if no available manager exists
     */
    setManager(): Promise<boolean>;
    /**
     * Constructs a new HashManager.
     *
     * @param options Initialisation options
     */
    constructor(options: HashManagerCoreOptions);
    /**
     * Initialises the hash manager.
     *
     * @returns True if initialisation is successful
     * @throws Throws an error if initialisation fails
     */
    processInitialise(): Promise<boolean>;
    /**
     * Computes the hash value for the specified string.
     *
     * @param piece The string to be hashed
     * @returns The hash value (returned as a Promise)
     */
    computeHash(piece: string): Promise<string>;
    /**
     * Computes the hash value without encryption.
     *
     * @param piece The string to be hashed
     * @returns The hash value (returned as a Promise)
     */
    computeHashWithoutEncryption(piece: string): Promise<string>;
    /**
     * Computes the hash value with encryption.
     *
     * @param piece The string to be hashed
     * @returns The hash value (returned as a Promise)
     */
    computeHashWithEncryption(piece: string): Promise<string>;
}
