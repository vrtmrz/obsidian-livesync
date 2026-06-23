// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { EventHub } from "octagonal-wheels/events";
declare global {
    interface LSEvents {
        hello: string;
        world: undefined;
    }
}
export declare const eventHub: EventHub<LSEvents>;
