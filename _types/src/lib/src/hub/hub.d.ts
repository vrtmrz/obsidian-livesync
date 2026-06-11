import { EventHub } from "octagonal-wheels/events";
declare global {
    interface LSEvents {
        hello: string;
        world: undefined;
    }
}
export declare const eventHub: EventHub<LSEvents>;
