// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: f20eb19
export declare class ServiceContext {
}
export declare abstract class ServiceBase<T extends ServiceContext> {
    protected context: T;
    constructor(context: T);
}
