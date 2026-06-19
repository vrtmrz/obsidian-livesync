// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 6de1db1
export declare class ServiceContext {
}
export declare abstract class ServiceBase<T extends ServiceContext> {
    protected context: T;
    constructor(context: T);
}
