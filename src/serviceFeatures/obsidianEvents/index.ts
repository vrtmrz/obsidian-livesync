import { createObsidianServiceFeature } from "@/types.ts";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils.ts";

import type { ObsidianEventsServices, ObsidianEventsModules } from "./types.ts";
import { createObsidianEventsState } from "./state.ts";
import { bindObsidianEventsLifecycle } from "./eventBindings.ts";

/**
 * A service feature hook that initialises and manages Obsidian application event bindings.
 * This hooks into vault file changes, window focus, visibility states, and schedules restarts.
 */
export const useObsidianEvents = createObsidianServiceFeature<
    ObsidianEventsServices,
    ObsidianEventsModules,
    "app" | "plugin",
    void
>((host) => {
    const log = createInstanceLogFunction("ObsidianEvents", host.services.API);
    const state = createObsidianEventsState();
    bindObsidianEventsLifecycle(host, log, state);
});
