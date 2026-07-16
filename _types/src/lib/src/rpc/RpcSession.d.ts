// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 96033e1
import type { JsonLike } from "./types";
import type { RpcRoom } from "./RpcRoom";
export declare class RpcSession {
    readonly peerId: string;
    private room;
    constructor(room: RpcRoom, peerId: string);
    call<T = JsonLike>(method: string, args?: JsonLike[], timeoutMs?: number): Promise<T>;
    createProxy<T extends object>(namespace: string): T;
}
