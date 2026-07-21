import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { describe, expect, it } from "vitest";

import {
    observeServiceComposition,
    observeServiceContext,
    SERVICE_CONTEXT_MEMBERS,
} from "../../../test/contracts/serviceContext";
import { createLiveSyncBrowserServiceHub } from "./createLiveSyncBrowserServiceHub";

describe("LiveSync browser service context contract", () => {
    it("preserves one injected context and its API results throughout the Webapp composition", () => {
        const context = createServiceContext({
            translate: (key) => `webapp:${key}`,
        });
        const hub = createLiveSyncBrowserServiceHub({ context });

        expect(observeServiceContext(context, "moduleLocalDatabase.logWaitingForReady")).toEqual({
            translation: "webapp:moduleLocalDatabase.logWaitingForReady",
            receivedEvents: ["context-contract-event"],
        });
        const composition = observeServiceComposition(hub, context);
        expect(composition.hubUsesExpectedContext).toBe(true);
        expect(SERVICE_CONTEXT_MEMBERS.filter((member) => !composition.servicesUsingExpectedContext[member])).toEqual(
            []
        );
    });
});
