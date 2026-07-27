import { describe, expect, it } from "vitest";

import { eventHub } from "@/common/events";
import { translateLiveSyncMessage } from "@/common/translation";
import {
    observeServiceComposition,
    observeServiceContext,
    SERVICE_CONTEXT_MEMBERS,
} from "../../../../test/contracts/serviceContext";
import { NodeServiceContext } from "./NodeServiceContext";
import { NodeServiceHub } from "./NodeServiceHub";
import type { StandardIo } from "@vrtmrz/livesync-commonlib/context";

const TRANSLATION_KEY = "Replicator.Message.InitialiseFatalError";

describe("NodeServiceContext contract", () => {
    it("preserves the CLI capabilities and host-neutral API results", () => {
        const standardIo: StandardIo = {
            readStdin: async () => "input",
            prompt: async () => "answer",
            writeStdout: () => undefined,
            writeStderr: () => undefined,
        };
        const context = new NodeServiceContext("/tmp/livesync-context-contract", standardIo);

        expect(observeServiceContext(context, TRANSLATION_KEY)).toEqual({
            translation: translateLiveSyncMessage(TRANSLATION_KEY),
            receivedEvents: ["context-contract-event"],
        });
        expect(context.events).toBe(eventHub);
        expect(context.databasePath).toBe("/tmp/livesync-context-contract");
        expect(context.standardIo).toBe(standardIo);

        const hub = new NodeServiceHub(context.databasePath, context);
        const composition = observeServiceComposition(hub, context);
        expect(composition.hubUsesExpectedContext).toBe(true);
        expect(SERVICE_CONTEXT_MEMBERS.filter((member) => !composition.servicesUsingExpectedContext[member])).toEqual(
            []
        );
    });
});
