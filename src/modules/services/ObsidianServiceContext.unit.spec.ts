import { describe, expect, it } from "vitest";

import { eventHub } from "@/common/events";
import { translateLiveSyncMessage } from "@/common/translation";
import { observeServiceContext } from "../../../test/contracts/serviceContext";
import { ObsidianServiceContext } from "./ObsidianServiceContext";

const TRANSLATION_KEY = "Replicator.Message.InitialiseFatalError";

describe("ObsidianServiceContext contract", () => {
    it("preserves the plug-in capabilities and host-neutral API results", () => {
        type Parameters = ConstructorParameters<typeof ObsidianServiceContext>;
        const app = {} as Parameters[0];
        const plugin = {} as Parameters[1];
        const liveSyncPlugin = {} as Parameters[2];
        const context = new ObsidianServiceContext(app, plugin, liveSyncPlugin);

        expect(observeServiceContext(context, TRANSLATION_KEY)).toEqual({
            translation: translateLiveSyncMessage(TRANSLATION_KEY),
            receivedEvents: ["context-contract-event"],
        });
        expect(context.events).toBe(eventHub);
        expect(context.app).toBe(app);
        expect(context.plugin).toBe(plugin);
        expect(context.liveSyncPlugin).toBe(liveSyncPlugin);
    });
});
