// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { JsonLike, RpcErrorCode, RpcErrorShape } from "./types";
export declare class RpcError extends Error {
    code: RpcErrorCode;
    details?: JsonLike;
    constructor(code: RpcErrorCode, message: string, details?: JsonLike);
    toShape(): RpcErrorShape;
}
export declare function asRpcErrorShape(ex: unknown): RpcErrorShape;
