// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: a58965f
import { EventHub } from "octagonal-wheels/events";
declare global {
    interface LSEvents {
        hello: string;
        world: undefined;
    }
}
export declare const eventHub: EventHub<LSEvents>;
