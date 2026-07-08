// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
export declare const isValidRemoteCouchDBURI: (uri: string) => boolean;
export declare function isCloudantURI(uri: string): boolean;
export declare function isErrorOfMissingDoc(ex: unknown): boolean;
export declare const _requestToCouchDBFetch: (baseUri: string, username: string, password: string, path?: string, body?: unknown, method?: string) => Promise<Response>;
