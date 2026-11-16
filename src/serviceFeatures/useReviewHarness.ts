import { NEW_VAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/settings";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import type ObsidianLiveSyncPlugin from "@/main";
import type { LiveSyncCore } from "@/main";
import type { WorkspaceLeaf } from "@/deps";
import {
    ReviewHarnessController,
    REVIEW_HARNESS_STATE_KEY,
    type ReviewHarnessRuntime,
} from "@/features/ReviewHarness/reviewHarnessController";
import { ReviewHarnessView, VIEW_TYPE_REVIEW_HARNESS } from "@/features/ReviewHarness/ReviewHarnessView";
import type { ReviewHarnessScenarioResult } from "@/features/ReviewHarness/reviewHarnessContract";
import {
    REVIEW_HARNESS_FIXTURE_ROOT,
    runReviewHarnessVaultRoundTrip,
} from "@/features/ReviewHarness/reviewHarnessVaultFixture";
import type { CompatibilityReviewController } from "./compatibilityReview";
import { runReviewHarnessIdBenchmark } from "@/features/ReviewHarness/reviewHarnessIdBenchmark";
import { createIdBenchmarkOperations } from "@/features/ReviewHarness/reviewHarnessIdBenchmarkRuntime";
import { runReviewHarnessFileContentHashBenchmark } from "@/features/ReviewHarness/reviewHarnessFileContentHashBenchmark";
import { createFileContentHashBenchmarkOperations } from "@/features/ReviewHarness/reviewHarnessFileContentHashBenchmarkRuntime";
import {
    ReviewHarnessDatabaseProbeController,
    type DatabaseProbeEvent,
} from "@/features/ReviewHarness/reviewHarnessDatabaseProbe";
import {
    awaitDatabaseProbeOperation,
    createDatabaseProbeFixture,
    databaseProbeErrorName,
    observeDatabaseProbeBrowserEvents,
} from "@/features/ReviewHarness/reviewHarnessDatabaseProbeRuntime";
import commonlibPackage from "@vrtmrz/livesync-commonlib/package.json";

function createDatabaseProbe(core: LiveSyncCore): ReviewHarnessDatabaseProbeController {
    const services = core.services;
    const withLog = (emit: (event: DatabaseProbeEvent) => void) => (event: DatabaseProbeEvent) => {
        services.API.addLog(
            `[Review Harness: IndexedDB] ${event.source}.${event.name}${event.registration ? ` listener=${event.registration}` : ""}${event.detail ? ` ${event.detail}` : ""}`,
            LOG_LEVEL_INFO
        );
        emit(event);
    };
    return new ReviewHarnessDatabaseProbeController({
        now: () => new Date(),
        confirmStart: async () =>
            services.setting.currentSettings().enableDebugTools &&
            (await services.UI.confirm.askYesNoDialog(
                "Use a dedicated test Vault. This diagnostic creates a disposable local database, observes events, and can close only that fixture's native connection. The active LiveSync database is inspected read-only. Continue?",
                { title: "Review Harness: IndexedDB connection observation", defaultOption: "No" }
            )) === "yes",
        createFixture: async (emit, signal) => {
            const record = withLog(emit);
            const { PouchDB } = await import("@vrtmrz/livesync-commonlib/compat/pouchdb/pouchdb-browser");
            record({
                source: "probe",
                name: "versions",
                detail: `Commonlib=${commonlibPackage.version}; PouchDB=${PouchDB.version}; adapter=idb; probe=1`,
            });
            return await createDatabaseProbeFixture({
                factory: activeWindow.indexedDB,
                PouchDB,
                token: activeWindow.crypto.randomUUID(),
                emit: record,
                signal,
            });
        },
        observeLifecycle: (emit) => {
            const record = withLog(emit);
            const removers = [observeDatabaseProbeBrowserEvents(activeDocument, activeWindow, record)];
            for (const name of ["onSuspending", "onResuming", "onResumed", "onBeforeUnload", "onUnload"] as const) {
                removers.push(
                    services.appLifecycle[name].addHandler(() => {
                        record({ source: "host", name });
                        return Promise.resolve(true);
                    })
                );
                record({ source: "host", name, registration: "registered" });
            }
            const database = services.database.localDatabaseDirect?.localDatabase;
            if (database) {
                for (const name of ["close", "closed"] as const) {
                    const handler = () => record({ source: "active-local-pouch", name });
                    database.on(name, handler);
                    removers.push(() => {
                        database.removeListener(name, handler);
                    });
                    record({ source: "active-local-pouch", name, registration: "registered" });
                }
            }
            record({
                source: "active-local-native",
                name: "close",
                registration: "unavailable",
                detail: "The active database's native handle is not exposed; only the fixture native handle is observed.",
            });
            return () => {
                for (const remove of removers) remove();
            };
        },
        inspectActiveDatabase: async (signal) => {
            const ready = services.database.isDatabaseReady();
            const database = services.database.localDatabaseDirect?.localDatabase;
            const observations = [
                `active-local.ready=${String(ready)}`,
                `application.ready=${String(services.appLifecycle.isReady())}`,
            ];
            if (!database)
                return { observations: [...observations, "active-local.info=unavailable"], connectionFailure: false };
            let connectionFailure = false;
            try {
                const info = await awaitDatabaseProbeOperation(database.info(), signal);
                const adapter = (info as { adapter?: unknown }).adapter;
                observations.push(
                    `active-local.adapter=${adapter === "idb" || adapter === "indexeddb" ? adapter : "unavailable"}`
                );
                observations.push("active-local.info=ok");
            } catch (error) {
                if (signal.aborted) {
                    throw error;
                }
                const name = databaseProbeErrorName(error);
                connectionFailure = name === "InvalidStateError" || name === "UnknownError";
                observations.push(`active-local.info=error; name=${name}`);
            }
            for (const detail of observations)
                services.API.addLog(`[Review Harness: IndexedDB] ${detail}`, LOG_LEVEL_INFO);
            return { observations, connectionFailure };
        },
    });
}

async function runVaultRoundTrip(plugin: ObsidianLiveSyncPlugin): Promise<ReviewHarnessScenarioResult> {
    const vault = plugin.app.vault;
    return runReviewHarnessVaultRoundTrip({
        confirmFixtureAccess: async () =>
            (await plugin.core.services.UI.confirm.askYesNoDialog(
                "This scenario creates, reads, modifies, renames, and removes one owned fixture tree. Use a dedicated test Vault. Continue?",
                {
                    title: "Review Harness: Vault fixture access",
                    defaultOption: "No",
                }
            )) === "yes",
        fixtureRootExists: () => vault.getAbstractFileByPath(REVIEW_HARNESS_FIXTURE_ROOT) !== null,
        createFixtureRoot: async () => {
            await vault.createFolder(REVIEW_HARNESS_FIXTURE_ROOT);
        },
        createFile: (path, content) => vault.create(path, content),
        readFile: (file) => vault.read(file),
        modifyFile: (file, content) => vault.modify(file, content),
        renameFile: (file, path) => vault.rename(file, path),
        filePath: (file) => file.path,
        removeFixtureRoot: async () => {
            const fixtureRoot = vault.getAbstractFileByPath(REVIEW_HARNESS_FIXTURE_ROOT);
            if (fixtureRoot) await plugin.app.fileManager.trashFile(fixtureRoot);
        },
    });
}

export function useReviewHarness(
    core: LiveSyncCore,
    plugin: ObsidianLiveSyncPlugin,
    compatibilityReview: CompatibilityReviewController
): ReviewHarnessController {
    const services = core.services;
    const databaseProbe = createDatabaseProbe(core);
    const runtime: ReviewHarnessRuntime = {
        databaseProbe,
        now: () => new Date(),
        getSettings: () => services.setting.currentSettings(),
        getNewVaultSettings: () => NEW_VAULT_SETTINGS,
        getSettingsMigrationState: () => services.setting.getSettingsMigrationState(),
        isCompatibilityReviewInitialised: () => compatibilityReview.initialised,
        getCompatibilityPause: () => compatibilityReview.pendingPause,
        openCompatibilityReview: () => compatibilityReview.openReview(),
        runVaultRoundTrip: () => runVaultRoundTrip(plugin),
        runIdBenchmark: async () =>
            runReviewHarnessIdBenchmark(await createIdBenchmarkOperations(), activeWindow.performance),
        runFileContentHashBenchmark: async () =>
            runReviewHarnessFileContentHashBenchmark(
                await createFileContentHashBenchmarkOperations(activeWindow.performance),
                activeWindow.performance
            ),
        readContinuation: () => services.config.getValue(REVIEW_HARNESS_STATE_KEY, ""),
        writeContinuation: (value) => services.config.setValue(REVIEW_HARNESS_STATE_KEY, value),
        deleteContinuation: () => services.config.delete(REVIEW_HARNESS_STATE_KEY),
        restart: () => services.appLifecycle.performRestart(),
        reportError: (error) => services.API.addLog(error, LOG_LEVEL_NOTICE),
        copyText: async (value) => {
            if (!activeWindow.navigator.clipboard) throw new Error("Clipboard access is unavailable on this device.");
            await activeWindow.navigator.clipboard.writeText(value);
        },
        getEnvironment: () => ({
            pluginVersion: services.API.getPluginVersion(),
            obsidianVersion: services.API.getAppVersion(),
            platform: services.API.getPlatform(),
            userAgent: activeWindow.navigator.userAgent || "unavailable",
            viewport:
                typeof activeWindow.innerWidth === "number" && typeof activeWindow.innerHeight === "number"
                    ? `${activeWindow.innerWidth}x${activeWindow.innerHeight}`
                    : "unavailable",
        }),
    };
    const controller = new ReviewHarnessController(runtime);
    services.appLifecycle.onUnload.addHandler(async () => {
        await databaseProbe.dispose();
        controller.dispose();
        return true;
    });
    let continuationConsumed = false;
    let registered = false;
    let openAfterLayout = false;

    services.appLifecycle.onSettingLoaded.addHandler(async () => {
        if (!continuationConsumed) {
            await controller.consumeContinuation();
            continuationConsumed = true;
        }
        const snapshot = controller.snapshot();
        openAfterLayout = snapshot.resumedRequestId !== null || snapshot.continuationError !== null;
        if (!services.setting.currentSettings().enableDebugTools || registered) return true;

        registered = true;
        services.API.registerWindow(
            VIEW_TYPE_REVIEW_HARNESS,
            (leaf: WorkspaceLeaf) => new ReviewHarnessView(leaf, controller)
        );
        services.API.addCommand({
            id: "open-review-harness",
            name: "Open review harness",
            callback: () => {
                void services.API.showWindow(VIEW_TYPE_REVIEW_HARNESS);
            },
        });
        return true;
    });

    services.appLifecycle.onLayoutReady.addHandler(() => {
        if (openAfterLayout && services.setting.currentSettings().enableDebugTools) {
            void services.API.showWindow(VIEW_TYPE_REVIEW_HARNESS);
        }
        return Promise.resolve(true);
    });

    return controller;
}
