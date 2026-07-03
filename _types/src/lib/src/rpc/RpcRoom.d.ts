// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { RpcSession } from "./RpcSession";
import { type JsonLike, type RpcMethodHandler, type RpcRegisterOptions, type RpcRoomOptions } from "./types";
export declare class RpcRoom {
    private options;
    private pending;
    private inboundCalls;
    private methods;
    private sessions;
    private outgoingChunkMap;
    private incomingChunkMap;
    private incomingChunkTimers;
    private peerVersion;
    private disposer;
    constructor(options: RpcRoomOptions);
    close(): void;
    session(peerId: string): RpcSession;
    register<T extends JsonLike[], U>(method: string, handler: RpcMethodHandler<T, U>, options?: RpcRegisterOptions): void;
    invoke(peerId: string, method: string, args: JsonLike[], timeoutMs?: number): Promise<JsonLike>;
    cancel(peerId: string, requestId: string): Promise<void>;
    private sendEnvelope;
    private scheduleMissingAck;
    private onWireMessage;
    private onEnvelopePayload;
}
