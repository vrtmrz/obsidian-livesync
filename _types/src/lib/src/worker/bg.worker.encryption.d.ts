// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 6de1db1
import type { EncryptHKDFArguments } from "./universalTypes.ts";
import type { EncryptArguments } from "./universalTypes.ts";
/**
 * Processes the encryption of data.
 * @param data The data to be encrypted or decrypted.
 */
export declare function processEncryption(data: EncryptArguments | EncryptHKDFArguments): Promise<void>;
