// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { RpcRoom } from "@lib/rpc/RpcRoom";
/**
 * Exposes a PouchDB database as a set of RPC methods registered on an
 * {@link RpcRoom}.  The remote peer can access the database via
 * {@link RpcPouchDBProxy}.
 *
 * All methods are registered under the given namespace prefix `ns` (default:
 * `'pdb'`).  For example, with the default namespace the method names are
 * `pdb.info`, `pdb.id`, `pdb.changes`, `pdb.get`, `pdb.put`, `pdb.bulkGet`,
 * `pdb.bulkDocs`, `pdb.revsDiff`, and `pdb.allDocs`.
 *
 * @param room  The {@link RpcRoom} on which to register handlers.
 * @param db    The PouchDB database instance to expose.
 * @param ns    Method namespace prefix (default: `'pdb'`).
 */
export declare function exposeDB(room: RpcRoom, db: PouchDB.Database<object>, ns?: string): void;
