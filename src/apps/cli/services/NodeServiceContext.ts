import { eventHub } from "@/common/events";
import { translateLiveSyncMessage } from "@/common/translation";
import { ServiceContext, type StandardIo } from "@vrtmrz/livesync-commonlib/context";

/** Host capabilities owned by one Self-hosted LiveSync CLI composition. */
export class NodeServiceContext extends ServiceContext {
    constructor(
        readonly databasePath: string,
        readonly standardIo: StandardIo
    ) {
        super({ events: eventHub, translate: translateLiveSyncMessage });
    }
}
