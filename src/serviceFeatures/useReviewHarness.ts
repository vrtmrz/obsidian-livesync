import { runReviewHarnessDatabaseAbort } from "@/features/ReviewHarness/reviewHarnessDatabaseAbort";
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
import type { DatabaseProbeStage } from "@/features/ReviewHarness/reviewHarnessDatabaseProbeTypes";
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
        const kind = event.registration ? `registration=${event.registration}` : "event=received";
        services.API.addLog(
            `[Review Harness: IndexedDB] ${event.source}.${event.name} stage=${event.stage ?? "baseline"} ${kind}${event.detail ? ` ${event.detail}` : ""}`,
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
            const removers = [
                observeDatabaseProbeBrowserEvents(activeDocument, activeWindow, (event) =>
                    record({
                        ...event,
                        stage:
                            event.stage ??
                            (event.registration || event.name === "initial-state"
                                ? "baseline"
                                : "background-transition"),
                    })
                ),
            ];
            for (const name of ["onSuspending", "onResuming", "onResumed", "onBeforeUnload", "onUnload"] as const) {
                removers.push(
                    services.appLifecycle[name].addHandler(() => {
                        record({ source: "host", name, stage: "background-transition" });
                        return Promise.resolve(true);
                    })
                );
                record({ source: "host", name, registration: "registered", stage: "baseline" });
            }
            const database = services.database.localDatabaseDirect?.localDatabase;
            if (database) {
                for (const name of ["close", "closed"] as const) {
                    const handler = () =>
                        record({ source: "active-local-pouch", name, stage: "background-transition" });
                    database.on(name, handler);
                    removers.push(() => {
                        database.removeListener(name, handler);
                    });
                    record({ source: "active-local-pouch", name, registration: "registered", stage: "baseline" });
                }
            }
            record({
                source: "active-local-native",
                name: "close",
                registration: "unavailable",
                stage: "baseline",
                detail: "The active database's native handle is not exposed; only the fixture native handle is observed.",
            });
            return () => {
                for (const remove of removers) remove();
            };
        },
        inspectActiveDatabase: async (signal, stage: DatabaseProbeStage) => {
            const ready = services.database.isDatabaseReady();
            const database = services.database.localDatabaseDirect?.localDatabase;
            const observations = [
                `active-local.ready=${String(ready)}`,
                `application.ready=${String(services.appLifecycle.isReady())}`,
            ];
            if (!database) {
                observations.push("active-local.info=unavailable");
                const sampledAt = new Date().toISOString();
                for (const detail of observations) {
                    services.API.addLog(
                        `[Review Harness: IndexedDB] active sample; stage=${stage}; sampledAt=${sampledAt}; ${detail}`,
                        LOG_LEVEL_INFO
                    );
                }
                return { observations, connectionFailure: false };
            }
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
            const sampledAt = new Date().toISOString();
            for (const detail of observations) {
                services.API.addLog(
                    `[Review Harness: IndexedDB] active sample; stage=${stage}; sampledAt=${sampledAt}; ${detail}`,
                    LOG_LEVEL_INFO
                );
            }
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
    const databaseProbe = createDatabaseProbe(core);
    const runtime = createReviewHarnessRuntime(core, plugin, compatibilityReview, databaseProbe);
    const controller = new ReviewHarnessController(runtime);
    registerReviewHarnessLifecycle(core, controller, databaseProbe);
    return controller;
}

/**
 * Build the runtime adapters used by one controller. Settings, compatibility state, and host APIs are read
 * when their operations run so the controller observes the current host state.
 */
function createReviewHarnessRuntime(
    core: LiveSyncCore,
    plugin: ObsidianLiveSyncPlugin,
    compatibilityReview: CompatibilityReviewController,
    databaseProbe: ReviewHarnessDatabaseProbeController
): ReviewHarnessRuntime {
    const services = core.services;
    return {
        databaseProbe,
        runDatabaseAbortDiagnostic: async () => {
            const { PouchDB } = await import("@vrtmrz/livesync-commonlib/compat/pouchdb/pouchdb-browser");
            return await runReviewHarnessDatabaseAbort({
                factory: activeWindow.indexedDB,
                PouchDB,
                createToken: () => activeWindow.crypto.randomUUID(),
                confirmStart: async () =>
                    services.setting.currentSettings().enableDebugTools &&
                    (await services.UI.confirm.askYesNoDialog(
                        "This development diagnostic aborts a read in disposable local databases and records events and operation state. Copy the report afterwards, then press Restart Obsidian. It does not change the active Vault database or restart automatically. Continue?",
                        { title: "Review Harness: transaction abort", defaultOption: "No" }
                    )) === "yes",
                logEvent: (event) =>
                    services.API.addLog(
                        `[Review Harness: transaction abort] ${event.source}.${event.name}: ${event.registration ?? "received"}${event.detail ? `; ${event.detail}` : ""}`,
                        LOG_LEVEL_INFO
                    ),
            });
        },
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
}

/** State retained by the lifecycle handlers belonging to one Review Harness composition. */
interface ReviewHarnessLifecycleContext {
    /** Set only after continuation consumption completes, so a failed deletion can be retried. */
    continuationConsumed: boolean;
    /** Prevents the view and command from being registered more than once for this composition. */
    debugUiRegistered: boolean;
    /** Carries a restored continuation from settings-loaded to the later layout-ready stage. */
    openAfterLayout: boolean;
}

function createReviewHarnessLifecycleContext(): ReviewHarnessLifecycleContext {
    return {
        continuationConsumed: false,
        debugUiRegistered: false,
        openAfterLayout: false,
    };
}

/**
 * Consume the saved continuation once and remember whether layout-ready should reopen the Harness.
 * The returned promise covers continuation reading, deletion, and restoration; a failure rejects and leaves
 * the one-shot flag clear so a later settings-loaded invocation can retry.
 */
async function restoreReviewHarnessContinuation(
    controller: ReviewHarnessController,
    context: ReviewHarnessLifecycleContext
): Promise<void> {
    if (!context.continuationConsumed) {
        await controller.consumeContinuation();
        context.continuationConsumed = true;
    }
    const snapshot = controller.snapshot();
    context.openAfterLayout = snapshot.resumedRequestId !== null || snapshot.continuationError !== null;
}

type ReviewHarnessUiApi = Pick<LiveSyncCore["services"]["API"], "registerWindow" | "addCommand" | "showWindow">;

/** Register the debug-only view and command after settings have loaded. */
function registerReviewHarnessDebugUi(
    api: ReviewHarnessUiApi,
    controller: ReviewHarnessController,
    context: ReviewHarnessLifecycleContext,
    enableDebugTools: boolean
): void {
    if (!enableDebugTools || context.debugUiRegistered) {
        return;
    }

    context.debugUiRegistered = true;
    api.registerWindow(VIEW_TYPE_REVIEW_HARNESS, (leaf: WorkspaceLeaf) => new ReviewHarnessView(leaf, controller));
    api.addCommand({
        id: "open-review-harness",
        name: "Open review harness",
        callback: () => {
            void api.showWindow(VIEW_TYPE_REVIEW_HARNESS);
        },
    });
}

/**
 * Reopen a restored Harness only after layout is ready and debug tools are still enabled.
 * The lifecycle promise covers this decision; the view-opening promise remains deliberately fire-and-forget.
 */
function openReviewHarnessAfterLayout(
    api: ReviewHarnessUiApi,
    context: ReviewHarnessLifecycleContext,
    enableDebugTools: boolean
): Promise<boolean> {
    if (context.openAfterLayout && enableDebugTools) {
        void api.showWindow(VIEW_TYPE_REVIEW_HARNESS);
    }
    return Promise.resolve(true);
}

/** Bind controller disposal and the settings/layout operations to this composition's lifecycle. */
function registerReviewHarnessLifecycle(
    core: LiveSyncCore,
    controller: ReviewHarnessController,
    databaseProbe: ReviewHarnessDatabaseProbeController
): void {
    const services = core.services;
    const context = createReviewHarnessLifecycleContext();

    services.appLifecycle.onUnload.addHandler(async () => {
        await databaseProbe.dispose();
        controller.dispose();
        return true;
    });
    services.appLifecycle.onSettingLoaded.addHandler(async () => {
        await restoreReviewHarnessContinuation(controller, context);
        registerReviewHarnessDebugUi(
            services.API,
            controller,
            context,
            services.setting.currentSettings().enableDebugTools
        );
        return true;
    });
    services.appLifecycle.onLayoutReady.addHandler(() =>
        openReviewHarnessAfterLayout(services.API, context, services.setting.currentSettings().enableDebugTools)
    );
}
