// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
/**
 * Encrypts a string using a passphrase, unless the string is already encrypted.
 *
 * If the input string begins with `ENCRYPT_V2_PREFIX` or `HKDF_SALTED_ENCRYPTED_PREFIX`,
 * we assume it is already encrypted and return it unchanged.
 * Otherwise, we encrypt the string using an ephemeral salt and the provided passphrase.
 *
 * @param source - The plaintext string to encrypt, or an already encrypted string.
 * @param passphrase - The passphrase used for encryption.
 * @returns A promise resolving to the encrypted string, or the original string if it is already encrypted.
 */
export declare function encryptString(source: string, passphrase: string): Promise<string>;
/**
 * Decrypts an encrypted string using the provided passphrase.
 *
 * This function determines the encryption format by inspecting the string prefix, then applies
 * the appropriate decryption method. It supports several encryption formats, including
 * HKDF salted encryption and legacy formats (V1, V2, V3). If the format is not supported,
 * an error is thrown.
 *
 * @param encrypted - The encrypted string to decrypt.
 * @param passphrase - The passphrase used for decryption.
 * @returns A promise resolving to the decrypted string.
 * @throws {Error} If the encryption format is unsupported.
 */
export declare function decryptString(encrypted: string, passphrase: string): Promise<string>;
export declare function tryDecryptString(encrypted: string, passphrase: string | false): Promise<string | false>;
