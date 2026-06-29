// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
export declare const MAX_DOC_SIZE = 1000;
export declare const MAX_DOC_SIZE_BIN = 102400;
export declare const VER = 12;
export declare const RECENT_MODIFIED_DOCS_QTY = 30;
export declare const LEAF_WAIT_TIMEOUT = 30000;
export declare const LEAF_WAIT_ONLY_REMOTE = 5000;
export declare const LEAF_WAIT_TIMEOUT_SEQUENTIAL_REPLICATOR = 5000;
export declare const REPLICATION_BUSY_TIMEOUT = 3000000;
export declare const SALT_OF_PASSPHRASE = "rHGMPtr6oWw7VSa3W3wpa8fT8U";
export declare const SALT_OF_ID = "a83hrf7f\u0003y7sa8g31";
export declare const SEED_MURMURHASH = 305419896;
export declare const IDPrefixes: {
    Obfuscated: string;
    Chunk: string;
    EncryptedChunk: string;
};
/**
 * @deprecated Use `IDPrefixes.Obfuscated` instead.
 */
export declare const PREFIX_OBFUSCATED = "f:";
/**
 * @deprecated Use `IDPrefixes.Chunk` instead.
 */
export declare const PREFIX_CHUNK = "h:";
/**
 * @deprecated Use `IDPrefixes.EncryptedChunk` instead.
 */
export declare const PREFIX_ENCRYPTED_CHUNK = "h:+";
