import { LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { fireAndForget } from "octagonal-wheels/promises";
import type { FilePathWithPrefix } from "@lib/common/types.ts";
import type { DevFeatureHost } from "./types.ts";
import type { DevFeatureState } from "./state.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";

/**
 * Commits a log entry for missing translation keys inside local settings directory.
 *
 * @param host - The service feature host context.
 * @param log - The logger function.
 * @param key - The missing translation key.
 */
export async function onMissingTranslation(host: DevFeatureHost, log: LogFunction, key: string): Promise<void> {
    const app = host.context.app;
    const now = new Date();
    const filename = `missing-translation-`;
    const time = now.toISOString().split("T")[0];
    const outFile = `${filename}${time}.jsonl`;
    const piece = JSON.stringify({
        [key]: {},
    });
    const writePiece = piece.substring(1, piece.length - 1) + ",";
    try {
        const configDir = app.vault.configDir;
        await host.serviceModules.storageAccess.ensureDir(configDir + "/ls-debug/");
        await host.serviceModules.storageAccess.appendHiddenFile(configDir + "/ls-debug/" + outFile, writePiece + "\n");
    } catch (ex) {
        log(`Could not write ${outFile}`, LOG_LEVEL_VERBOSE);
        log(`Missing translation: ${writePiece}`, LOG_LEVEL_VERBOSE);
        log(ex, LOG_LEVEL_VERBOSE);
    }
}

/**
 * Automatically creates a conflicted revision for testing conflict resolution.
 *
 * @param host - The service feature host context.
 */
export async function createConflict(host: DevFeatureHost): Promise<void> {
    const filename = "test-create-conflict.md";
    const content = `# Test create conflict\n\n`;
    const w = await host.serviceModules.databaseFileAccess.store({
        name: filename,
        path: filename as FilePathWithPrefix,
        body: new Blob([content], { type: "text/markdown" }),
        stat: {
            ctime: new Date().getTime(),
            mtime: new Date().getTime(),
            size: content.length,
            type: "file",
        },
    });
    if (w) {
        const id = await host.services.path.path2id(filename as FilePathWithPrefix);
        const localDatabase = host.services.database.localDatabase;
        const f = await localDatabase.getRaw(id);
        console.log(f);
        console.log(f._rev);
        const revConflict = f._rev.split("-")[0] + "-" + (parseInt(f._rev.split("-")[1]) + 1).toString();
        console.log(await localDatabase.bulkDocsRaw([f], { new_edits: false }));
        console.log(await localDatabase.bulkDocsRaw([{ ...f, _rev: revConflict }], { new_edits: false }));
    }
}

/**
 * Appends a test result to the Svelte writable store.
 *
 * @param state - The active feature state.
 * @param name - The test name or category.
 * @param key - The unique test identifier.
 * @param result - True if passed, false if failed.
 * @param summary - Optional summary message.
 * @param message - Optional detailed stacktrace or assertion info.
 */
export function addTestResult(
    state: DevFeatureState,
    name: string,
    key: string,
    result: boolean,
    summary?: string,
    message?: string
): void {
    const logLine = `${name}: ${key} ${summary ?? ""}`;
    state.testResults.update((results) => {
        results.push([result, logLine, message ?? ""]);
        return results;
    });
}

/**
 * Dumps information of the specified document for debugging purposes.
 *
 * @param host - The service feature host context.
 * @param file - The file path to dump.
 */
export function dumpDocument(host: DevFeatureHost, file: string | undefined): void {
    if (!file) return;
    fireAndForget(() => host.services.database.localDatabase.getDBEntry(file as FilePathWithPrefix, {}, true, false));
}
