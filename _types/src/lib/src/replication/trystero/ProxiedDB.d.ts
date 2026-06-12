import { type ReplicatorHostEnv } from "./types";
export declare function createHostingDB(env: ReplicatorHostEnv): {
    info: () => Promise<PouchDB.Core.DatabaseInfo>;
    changes: (options: PouchDB.Core.ChangesOptions) => PouchDB.Core.Changes<import("../../common/types").EntryDoc>;
    revsDiff: (diff: PouchDB.Core.RevisionDiffOptions) => Promise<PouchDB.Core.RevisionDiffResponse>;
    bulkDocs: (docs: PouchDB.Core.PostDocument<any>[], options?: PouchDB.Core.BulkDocsOptions) => Promise<(PouchDB.Core.Response | PouchDB.Core.Error)[]>; // eslint-disable-line @typescript-eslint/no-explicit-any
    bulkGet: (options: PouchDB.Core.BulkGetOptions) => Promise<PouchDB.Core.BulkGetResponse<import("../../common/types").EntryDoc>>;
    put: (doc: PouchDB.Core.PutDocument<any>, options?: PouchDB.Core.PutOptions) => Promise<PouchDB.Core.Response>; // eslint-disable-line @typescript-eslint/no-explicit-any
    get: (id: string, options?: PouchDB.Core.GetOptions) => Promise<import("../../common/types").EntryDoc & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta>;
    _stopHosting: () => void;
};
export type HostingDB = ReturnType<typeof createHostingDB>;
