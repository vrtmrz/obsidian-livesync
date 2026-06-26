import { createObsidianServiceFeature } from "@/types.ts";
import { createInstanceLogFunction, type LogFunction } from "@lib/services/lib/logUtils.ts";

import { bindMigrationRequestEvents, runFirstInitialiseMigration } from "./migrationOperations.ts";
import type { MigrationModules, MigrationServices } from "./types.ts";

export const useMigrationFeature = createObsidianServiceFeature<MigrationServices, MigrationModules>((host) => {
    const log: LogFunction = createInstanceLogFunction("Migration", host.services.API);

    host.services.appLifecycle.onLayoutReady.addHandler(() => bindMigrationRequestEvents(host, log));
    host.services.appLifecycle.onFirstInitialise.addHandler(() => runFirstInitialiseMigration(host, log));

    return {};
});
