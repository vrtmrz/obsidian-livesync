declare module "pouchdb-merge" {
    export interface RevisionTreeNode {
        pos: number;
        ids: [revision: string, metadata: Record<string, unknown>, branches: RevisionTreeNode["ids"][]];
    }

    export function findPathToLeaf(revisions: RevisionTreeNode[], targetRevision: string): string[];
}

declare module "pouchdb-utils" {
    export function adapterFun<TThis, TArguments extends unknown[], TResult>(
        name: string,
        callback: (this: TThis, ...args: [...TArguments, callback: (error?: Error, result?: TResult) => void]) => void
    ): (this: TThis, ...args: TArguments) => Promise<TResult>;
}

declare module "pouchdb-errors" {
    export const MISSING_DOC: unknown;
    export const UNKNOWN_ERROR: unknown;
    export function createError(error: unknown, reason?: string): Error;
}
