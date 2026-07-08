// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
export declare function isErrorOf(ex: unknown, statusCode: number): boolean;
/**
 * Checks if the error is effectively a 404 error from CouchDB or PouchDB.
 * @param ex some error object, expected to be from CouchDB or PouchDB.
 * @returns true if the error is a 404 not found error, false otherwise.
 * @throws if the input is not an object or does not have a numeric "status" property.
 */
export declare function isNotFoundError(ex: unknown): boolean;
export declare function isConflictError(ex: unknown): boolean;
export declare function isUnauthorizedError(ex: unknown): boolean;
export declare function tryGetFilePath(entry: unknown): string | undefined;
