// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type ReplicatorHostEnv } from "./types";
import type { EntryDoc } from "@lib/common/models/db.definition";
export declare function createHostingDB(env: ReplicatorHostEnv): {
    info: () => Promise<PouchDB.Core.DatabaseInfo>;
    changes: (options: PouchDB.Core.ChangesOptions) => PouchDB.Core.Changes<EntryDoc>;
    revsDiff: (diff: PouchDB.Core.RevisionDiffOptions) => Promise<PouchDB.Core.RevisionDiffResponse>;
    bulkDocs: (docs: PouchDB.Core.PutDocument<EntryDoc & Record<string, unknown>>[], options?: PouchDB.Core.BulkDocsOptions) => Promise<(PouchDB.Core.Response | PouchDB.Core.Error)[]>;
    bulkGet: (options: PouchDB.Core.BulkGetOptions) => Promise<PouchDB.Core.BulkGetResponse<EntryDoc>>;
    put: (doc: PouchDB.Core.PutDocument<EntryDoc & Record<string, unknown>>, options?: PouchDB.Core.PutOptions) => Promise<PouchDB.Core.Response>;
    get: (id: string, options?: PouchDB.Core.GetOptions) => Promise<EntryDoc & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta>;
    _stopHosting: () => void;
};
export type HostingDB = ReturnType<typeof createHostingDB>;
