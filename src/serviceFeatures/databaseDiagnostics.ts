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
        return { status: "available", bytes };
    } catch {
        return { status: "unreadable", reason: "content-unreadable" };
    }
}

/** Run only after the host has collected this run's name-display choice. */
export async function runDatabaseDiagnostic(
    host: DatabaseDiagnosticHost,
    kind: DatabaseDiagnosticKind,
    nameMode: DiagnosticNameMode,
    options: { signal?: AbortSignal; onProgress?(processed: number): void } = {}
): Promise<DatabaseDiagnosticOutput> {
    const configuration = JSON.stringify(host.services.setting.currentSettings());
    const settings = JSON.parse(configuration) as ObsidianLiveSyncSettings;
    const database = host.services.database.localDatabase.localDatabase;
    const isConfigurationCurrent = () =>
        JSON.stringify(host.services.setting.currentSettings()) === configuration &&
        host.services.database.localDatabase.localDatabase === database;
    const mapper = createDiagnosticNameMapper(nameMode);
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
            onProgress: (progress) => options.onProgress?.(progress.revisionsProcessed),
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
    const result = await analyseDatabaseIntegrity({
        local,
        remote:
            settings.remoteType === REMOTE_COUCHDB
                ? () =>
                      Promise.resolve(
                          createCouchDBDiagnosticSource({
                              settings,
                              signal: options.signal,
                              fetch: (request, requestOptions) =>
                                  settings.useRequestAPI
                                      ? host.services.API.nativeFetch(request, requestOptions)
                                      : host.services.API.webCompatFetch(request, requestOptions),
                          })
                      )
                : undefined,
        remoteUnavailableReason: settings.remoteType === REMOTE_COUCHDB ? "source-unavailable" : "unsupported-remote",
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
        onProgress: (progress) => options.onProgress?.(progress.processed),
    });
    const report = projectIntegrityReport(result, mapper, versions);
    return {
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
}
