import {
    analyseDatabaseIntegrity,
    analyseDatabaseUsage,
    createCouchDBDiagnosticSource,
    createDiagnosticNameMapper,
    createLocalDiagnosticSource,
    formatDiagnosticJSON,
    formatIntegrityMarkdown,
    formatUsageTSV,
    projectIntegrityReport,
    projectUsageReport,
    type DiagnosticContent,
    type DiagnosticNameMode,
    type DiagnosticStatus,
} from "@vrtmrz/livesync-commonlib/diagnostics";
import { REMOTE_COUCHDB, type ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import type { NecessaryServicesInterfaces } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import commonlibPackage from "@vrtmrz/livesync-commonlib/package.json";
import { LOG_LEVEL_INFO, Logger } from "octagonal-wheels/common/logger";

export type DatabaseDiagnosticKind = "usage" | "integrity";
export type DatabaseDiagnosticHost = NecessaryServicesInterfaces<
    "setting" | "database" | "path" | "API",
    "storageAccess"
>;

export interface DatabaseDiagnosticArtifact {
    format: "json" | "markdown" | "tsv";
    filename: string;
    content: string;
}

export interface DatabaseDiagnosticOutput {
    status: DiagnosticStatus;
    nameMode: DiagnosticNameMode;
    artifacts: DatabaseDiagnosticArtifact[];
}

export interface DatabaseDiagnosticProgress {
    phase: "usage" | "accounting" | "metadata" | "content";
    source?: "local" | "remote";
    processed: number;
    total?: number;
    totalIsFinal?: boolean;
    elapsedMs: number;
}

export async function readDiagnosticStorage(
    storage: Pick<StorageAccess, "statHidden" | "readHiddenFileBinary">,
    path: string
): Promise<DiagnosticContent> {
    if (/^(?:[/\\]|[a-zA-Z]:)/.test(path) || path.includes("\0") || path.split(/[/\\]/).includes("..")) {
        return { status: "unreadable", reason: "content-unreadable" };
    }
    try {
        const before = await storage.statHidden(path);
        if (!before) return { status: "missing" };
        if (before.type !== "file") return { status: "unreadable", reason: "content-unreadable" };
        const bytes = new Uint8Array(await storage.readHiddenFileBinary(path));
        const after = await storage.statHidden(path);
        if (
            !after ||
            after.type !== "file" ||
            before.mtime !== after.mtime ||
            before.ctime !== after.ctime ||
            before.size !== after.size ||
            bytes.byteLength !== after.size
        ) {
            return { status: "unreadable", reason: "storage-changed" };
        }
        return { status: "available", bytes, mtime: after.mtime };
    } catch {
        return { status: "unreadable", reason: "content-unreadable" };
    }
}

/** Run only after the host has collected this run's name-display choice. */
export async function runDatabaseDiagnostic(
    host: DatabaseDiagnosticHost,
    kind: DatabaseDiagnosticKind,
    nameMode: DiagnosticNameMode,
    options: {
        signal?: AbortSignal;
        onProgress?(progress: DatabaseDiagnosticProgress): void;
        includeRemote?: boolean;
    } = {}
): Promise<DatabaseDiagnosticOutput> {
    const started = performance.now();
    const configuration = JSON.stringify(host.services.setting.currentSettings());
    const settings = JSON.parse(configuration) as ObsidianLiveSyncSettings;
    const database = host.services.database.localDatabase.localDatabase;
    const isConfigurationCurrent = () =>
        JSON.stringify(host.services.setting.currentSettings()) === configuration &&
        host.services.database.localDatabase.localDatabase === database;
    const mapper = createDiagnosticNameMapper(nameMode);
    const httpRequestCounters = { httpRequests: 0, httpFailedRequests: 0, httpRequestDurationMs: 0 };
    const getHttpRequestCounters = () => ({
        httpRequests: httpRequestCounters.httpRequests,
        httpFailedRequests: httpRequestCounters.httpFailedRequests,
        httpRequestDurationMs: Math.round(httpRequestCounters.httpRequestDurationMs),
    });
    const versions = {
        commonlib: commonlibPackage.version,
        plugin: host.services.API.getPluginVersion(),
        application: host.services.API.getAppVersion(),
    };
    const local = createLocalDiagnosticSource(database);
    if (kind === "usage") {
        const result = await analyseDatabaseUsage({
            source: local,
            signal: options.signal,
            onProgress: (progress) =>
                options.onProgress?.({
                    phase: progress.phase === "accounting" ? "accounting" : "usage",
                    processed: progress.processed,
                    total: progress.total,
                    totalIsFinal: progress.totalIsFinal,
                    elapsedMs: Math.round(performance.now() - started),
                }),
        });
        if (!isConfigurationCurrent()) {
            result.errors.push({ code: "configuration_changed" });
            if (result.status === "complete") result.status = "partial";
        }
        const report = projectUsageReport(result, mapper, versions);
        const artifacts: DatabaseDiagnosticArtifact[] = [
            {
                format: "json",
                filename: `database-usage-${result.status}.json`,
                content: formatDiagnosticJSON(report),
            },
        ];
        // A standalone legacy TSV has no coverage fields. Partial runs retain
        // their rows in JSON together with the status and reasons.
        if (result.status === "complete") {
            artifacts.unshift({ format: "tsv", filename: "database-usage.tsv", content: formatUsageTSV(report) });
        }
        return { status: result.status, nameMode, artifacts };
    }
    const includeRemote = options.includeRemote !== false;
    const integrityOptions: Parameters<typeof analyseDatabaseIntegrity>[0] = {
        local,
        remote:
            includeRemote && settings.remoteType === REMOTE_COUCHDB
                ? () =>
                      Promise.resolve(
                          createCouchDBDiagnosticSource({
                              settings,
                              signal: options.signal,
                              fetch: async (request, requestOptions) => {
                                  const requestStarted = performance.now();
                                  httpRequestCounters.httpRequests++;
                                  try {
                                      const response = settings.useRequestAPI
                                          ? await host.services.API.nativeFetch(request, requestOptions)
                                          : await host.services.API.webCompatFetch(request, requestOptions);
                                      if (!response.ok) httpRequestCounters.httpFailedRequests++;
                                      return response;
                                  } catch (error) {
                                      httpRequestCounters.httpFailedRequests++;
                                      throw error;
                                  } finally {
                                      httpRequestCounters.httpRequestDurationMs += performance.now() - requestStarted;
                                  }
                              },
                          })
                      )
                : undefined,
        remoteUnavailableReason: includeRemote
            ? settings.remoteType === REMOTE_COUCHDB
                ? "source-unavailable"
                : "unsupported-remote"
            : undefined,
        includeRemote,
        path: {
            getPath: (entry) => host.services.path.getPath(entry),
            path2id: (path, prefix) => host.services.path.path2idWithSettings(path, settings, prefix),
        },
        settings: {
            encrypt: settings.encrypt,
            usePathObfuscation: settings.usePathObfuscation,
            handleFilenameCaseSensitive: settings.handleFilenameCaseSensitive,
            idDerivationVersion: settings.idDerivationVersion ?? 0,
            pathNormalizationVersion: settings.pathNormalizationVersion ?? 0,
        },
        readStorage: (path) => readDiagnosticStorage(host.serviceModules.storageAccess, path),
        isConfigurationCurrent,
        signal: options.signal,
        onProgress: (progress) => options.onProgress?.(progress),
        onLog: (event) =>
            Logger(
                `Database integrity inspection: ${JSON.stringify({ ...event, ...getHttpRequestCounters() })}`,
                LOG_LEVEL_INFO
            ),
    };
    const result = await analyseDatabaseIntegrity(integrityOptions);
    const formattingStarted = performance.now();
    const report = projectIntegrityReport(result, mapper, versions);
    const output: DatabaseDiagnosticOutput = {
        status: result.status,
        nameMode,
        artifacts: [
            {
                format: "markdown",
                filename: `database-integrity-${result.status}.md`,
                content: formatIntegrityMarkdown(report),
            },
            {
                format: "json",
                filename: `database-integrity-${result.status}.json`,
                content: formatDiagnosticJSON(report),
            },
        ],
    };
    const requestCounters = getHttpRequestCounters();
    Logger(
        `Database integrity report: status=${result.status}, observations=${result.observations.length}, ` +
            `httpRequests=${requestCounters.httpRequests}, httpFailedRequests=${requestCounters.httpFailedRequests}, ` +
            `httpRequestDurationMs=${requestCounters.httpRequestDurationMs}, ` +
            `formattingMs=${Math.round(performance.now() - formattingStarted)}, elapsedMs=${Math.round(performance.now() - started)}`,
        LOG_LEVEL_INFO
    );
    return output;
}
