// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type EntryDoc, type AnyEntry, type EntryLeaf, type DocumentID, type E2EEAlgorithm } from "@lib/common/types";
import { encryptWorker, decryptWorker, encryptHKDFWorker, decryptHKDFWorker } from "@lib/worker/bgWorker.ts";
export declare const encrypt: typeof encryptWorker;
export declare const decrypt: typeof decryptWorker;
export declare const encryptHKDF: typeof encryptHKDFWorker;
export declare const decryptHKDF: typeof decryptHKDFWorker;
export declare let preprocessOutgoing: (doc: AnyEntry | EntryLeaf) => Promise<AnyEntry | EntryLeaf>;
export declare let preprocessIncoming: (doc: EntryDoc) => Promise<EntryDoc>;
export declare function getConfiguredFunctionsForEncryption(passphrase: string, useDynamicIterationCount: boolean, migrationDecrypt: boolean, getPBKDF2Salt: () => Promise<Uint8Array>, algorithm: E2EEAlgorithm): {
    incoming: (doc: AnyEntry | EntryLeaf) => Promise<AnyEntry | EntryLeaf>;
    outgoing: (doc: EntryDoc) => Promise<AnyEntry | EntryLeaf>;
};
export declare const enableEncryption: (db: PouchDB.Database<EntryDoc>, passphrase: string, useDynamicIterationCount: boolean, migrationDecrypt: boolean, getPBKDF2Salt: () => Promise<Uint8Array>, algorithm: E2EEAlgorithm) => void;
export declare function disableEncryption(): void;
export declare const EDEN_ENCRYPTED_KEY: DocumentID;
export declare const EDEN_ENCRYPTED_KEY_HKDF: DocumentID;
export declare function shouldEncryptEden(doc: AnyEntry | EntryLeaf): doc is AnyEntry;
export declare function shouldEncryptEdenHKDF(doc: AnyEntry | EntryLeaf): doc is AnyEntry;
export declare function shouldDecryptEden(doc: AnyEntry | EntryLeaf): doc is AnyEntry;
export declare function shouldDecryptEdenHKDF(doc: AnyEntry | EntryLeaf): doc is AnyEntry;
