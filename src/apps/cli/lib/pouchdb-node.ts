import PouchDB from "pouchdb-core";

import HttpPouch from "pouchdb-adapter-http";
import mapreduce from "pouchdb-mapreduce";
import replication from "pouchdb-replication";

import LevelDBAdapter from "pouchdb-adapter-leveldb";

import find from "pouchdb-find";
import transform from "transform-pouch";
import { findPathToLeaf, type RevisionTreeNode } from "pouchdb-merge";
import { adapterFun } from "pouchdb-utils";
import { createError, MISSING_DOC, UNKNOWN_ERROR } from "pouchdb-errors";
import { mapAllTasksWithConcurrencyLimit, unwrapTaskResult } from "octagonal-wheels/concurrency/task";

PouchDB.plugin(LevelDBAdapter).plugin(HttpPouch).plugin(mapreduce).plugin(replication).plugin(find).plugin(transform);

type PurgeMultiResult = {
    ok: true;
    deletedRevs: string[];
    documentWasRemovedCompletely: boolean;
};
type PurgeMultiParam = [docId: string, rev$$1: string];
type PurgeLogDocument = {
    purgeSeq: number;
    purges: Array<{ docId: string; rev: string; purgeSeq: number }>;
};
type PurgeMultiResultMap = Record<string, unknown>;

interface PouchDBPrivateDatabase extends PouchDB.Database {
    adapter: string;
    purged_infos_limit: number;
    _getRevisionTree(
        documentId: string,
        callback: (error: Error | undefined, revisions?: RevisionTreeNode[]) => void
    ): void;
    _purge(
        documentId: string,
        revisionPath: string[],
        callback: (error: Error | undefined, result?: PurgeMultiResult) => void
    ): void;
    purgeMulti(documents: PurgeMultiParam[]): Promise<PurgeMultiResultMap>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isSuccessfulPurge(value: unknown): value is PurgeMultiResult {
    return isRecord(value) && value.ok === true;
}

function appendPurgeSeqs(db: PouchDBPrivateDatabase, docs: PurgeMultiParam[]) {
    return db
        .get<PurgeLogDocument>("_local/purges")
        .then(function (doc) {
            for (const [docId, rev$$1] of docs) {
                const purgeSeq = doc.purgeSeq + 1;
                doc.purges.push({
                    docId,
                    rev: rev$$1,
                    purgeSeq,
                });
                if (doc.purges.length > db.purged_infos_limit) {
                    doc.purges.splice(0, doc.purges.length - db.purged_infos_limit);
                }
                doc.purgeSeq = purgeSeq;
            }
            return doc;
        })
        .catch(function (error: unknown) {
            if (!isRecord(error) || error.status !== 404) {
                throw error;
            }
            return {
                _id: "_local/purges",
                purges: docs.map(([docId, rev$$1], idx) => ({
                    docId,
                    rev: rev$$1,
                    purgeSeq: idx,
                })),
                purgeSeq: docs.length,
            };
        })
        .then(function (doc) {
            return db.put(doc);
        });
}

/**
 * purge multiple documents at once.
 */
const pouchDBPrototype = (PouchDB as typeof PouchDB & { prototype: PouchDBPrivateDatabase }).prototype;

pouchDBPrototype.purgeMulti = adapterFun<PouchDBPrivateDatabase, [documents: PurgeMultiParam[]], PurgeMultiResultMap>(
    "_purgeMulti",
    function (
        this: PouchDBPrivateDatabase,
        docs: PurgeMultiParam[],
        callback: (error?: Error, result?: PurgeMultiResultMap) => void
    ) {
        if (typeof this._purge === "undefined") {
            return callback(
                createError(UNKNOWN_ERROR, "Purge is not implemented in the " + this.adapter + " adapter.")
            );
        }
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- The adapter task callbacks must retain this PouchDB instance.
        const self = this;
        const tasks = docs.map(
            (param) => () =>
                new Promise<[PurgeMultiParam, unknown]>((res) => {
                    const [docId, rev$$1] = param;
                    self._getRevisionTree(docId, (error, revs) => {
                        if (error) {
                            return res([param, error]);
                        }
                        if (!revs) {
                            return res([param, createError(MISSING_DOC)]);
                        }
                        let path: string[];
                        try {
                            path = findPathToLeaf(revs, rev$$1);
                        } catch (caught: unknown) {
                            const failure = caught instanceof Error && caught.message ? caught.message : caught;
                            return res([param, failure]);
                        }
                        self._purge(docId, path, (error, result) => {
                            if (error) {
                                return res([param, error]);
                            }
                            return res([param, result]);
                        });
                    });
                })
        );
        (async () => {
            const ret = await mapAllTasksWithConcurrencyLimit(1, tasks);
            const retAll: Array<[PurgeMultiParam, unknown]> = [];
            for (const entry of ret) {
                const outcome = unwrapTaskResult(entry);
                if (outcome instanceof Error) {
                    throw outcome;
                }
                retAll.push(outcome);
            }
            const successfullyPurged: PurgeMultiParam[] = [];
            const resultEntries: Array<[string, unknown]> = [];
            for (const [document, outcome] of retAll) {
                if (isSuccessfulPurge(outcome)) {
                    successfullyPurged.push(document);
                }
                resultEntries.push([document[0], outcome]);
            }
            await appendPurgeSeqs(self, successfullyPurged);
            const result: PurgeMultiResultMap = Object.fromEntries(resultEntries);
            return result;
        })()
            .then((result) => callback(undefined, result))
            .catch((caught: unknown) => {
                const error = caught instanceof Error ? caught : new Error(String(caught));
                callback(error);
            });
    }
);

export { PouchDB };
