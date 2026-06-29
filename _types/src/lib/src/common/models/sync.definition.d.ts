// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { EntryTypes } from "./db.const";
import type { DatabaseEntry, DocumentID } from "./db.type";
export declare const ProtocolVersions: {
    readonly UNSET: undefined;
    readonly LEGACY: 1;
    readonly ADVANCED_E2EE: 2;
};
export type ProtocolVersion = (typeof ProtocolVersions)[keyof typeof ProtocolVersions];
export declare const DOCID_SYNC_PARAMETERS: DocumentID;
export declare const DOCID_JOURNAL_SYNC_PARAMETERS: DocumentID;
export interface SyncParameters extends DatabaseEntry {
    _id: typeof DOCID_SYNC_PARAMETERS;
    _rev?: string;
    type: (typeof EntryTypes)["SYNC_PARAMETERS"];
    protocolVersion: ProtocolVersion;
    pbkdf2salt: string;
}
export declare const DEFAULT_SYNC_PARAMETERS: SyncParameters;
