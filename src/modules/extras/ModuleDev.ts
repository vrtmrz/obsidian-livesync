import { delay, fireAndForget } from "octagonal-wheels/promises";
import { __onMissingTranslation } from "../../lib/src/common/i18n";
import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, Logger } from "octagonal-wheels/common/logger";
import { eventHub } from "../../common/events";
import { enableTestFunction } from "./devUtil/testUtils.ts";
import { TestPaneView, VIEW_TYPE_TEST } from "./devUtil/TestPaneView.ts";
import { writable } from "svelte/store";
import type { CouchDBCredentials, FilePathWithPrefix } from "../../lib/src/common/types.ts";
import type { LiveSyncCore } from "../../main.ts";
import { getConfiguredFunctionsForEncryption } from "@/lib/src/pouchdb/encryption.ts";
import { AuthorizationHeaderGenerator } from "@/lib/src/replication/httplib.ts";
import { fetchChangesForInitialSync } from "@/lib/src/pouchdb/StreamingFetch.ts";
import { PouchDB } from '@lib/pouchdb/pouchdb-browser.ts';
import { sizeToHumanReadable } from "octagonal-wheels/number";
export class ModuleDev extends AbstractObsidianModule {
    _everyOnloadStart(): Promise<boolean> {
        __onMissingTranslation(() => { });
        return Promise.resolve(true);
    }
    async onMissingTranslation(key: string): Promise<void> {
        const now = new Date();
        const filename = `missing-translation-`;
        const time = now.toISOString().split("T")[0];
        const outFile = `${filename}${time}.jsonl`;
        const piece = JSON.stringify({
            [key]: {},
        });
        const writePiece = piece.substring(1, piece.length - 1) + ",";
        try {
            await this.core.storageAccess.ensureDir(this.app.vault.configDir + "/ls-debug/");
            await this.core.storageAccess.appendHiddenFile(
                this.app.vault.configDir + "/ls-debug/" + outFile,
                writePiece + "\n"
            );
        } catch (ex) {
            this._log(`Could not write ${outFile}`, LOG_LEVEL_VERBOSE);
            this._log(`Missing translation: ${writePiece}`, LOG_LEVEL_VERBOSE);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
    }

    private _everyOnloadAfterLoadSettings(): Promise<boolean> {
        if (!this.settings.enableDebugTools) return Promise.resolve(true);
        this.onMissingTranslation = this.onMissingTranslation.bind(this);
        __onMissingTranslation((key) => {
            void this.onMissingTranslation(key);
        });
        type STUB = {
            toc: Set<string>;
            stub: { [key: string]: { [key: string]: Map<string, Record<string, string>> } };
        };
        eventHub.onEvent("document-stub-created", (detail: STUB) => {
            fireAndForget(async () => {
                const stub = detail.stub;
                const toc = detail.toc;

                const stubDocX = Object.entries(stub)
                    .map(([key, value]) => {
                        return [
                            `## ${key}`,
                            Object.entries(value)
                                .map(([key2, value2]) => {
                                    return [
                                        `### ${key2}`,
                                        [...value2.entries()].map(([key3, value3]) => {
                                            // return `#### ${key3}` + "\n" + JSON.stringify(value3);
                                            const isObsolete = value3["is_obsolete"] ? " (obsolete)" : "";
                                            const desc = value3["desc"] ?? "";
                                            const key = value3["key"] ? "Setting key: " + value3["key"] + "\n" : "";
                                            return `#### ${key3}${isObsolete}\n${key}${desc}\n`;
                                        }),
                                    ].flat();
                                })
                                .flat(),
                        ].flat();
                    })
                    .flat();
                const stubDocMD =
                    `
| Icon  | Description                                                       |
| :---: | ----------------------------------------------------------------- |
` +
                    [...toc.values()].map((e) => `${e}`).join("\n") +
                    "\n\n" +
                    stubDocX.join("\n");
                await this.core.storageAccess.writeHiddenFileAuto(
                    this.app.vault.configDir + "/ls-debug/stub-doc.md",
                    stubDocMD
                );
            });
        });

        enableTestFunction(this.plugin);
        this.registerView(VIEW_TYPE_TEST, (leaf) => new TestPaneView(leaf, this.plugin, this));
        this.addCommand({
            id: "view-test",
            name: "Open Test dialogue",
            callback: () => {
                void this.services.API.showWindow(VIEW_TYPE_TEST);
            },
        });
        return Promise.resolve(true);
    }
    async _runBulkCopyTest() {
        const settings = this.settings;
        const dummyLocalDatabaseForDrop = new PouchDB("dummy-local");
        await dummyLocalDatabaseForDrop.destroy();
        const dummyLocalDatabase = new PouchDB("dummy-local");
        const replicator = await this.core.services.replicator.getNewReplicator();
        if (!replicator) {
            return;
        }
        const salt = () => replicator.getReplicationPBKDF2Salt(settings);
        const enc = getConfiguredFunctionsForEncryption(settings.passphrase,
            false,
            false,
            salt,
            settings.E2EEAlgorithm,
        );

        const auth = (
            settings.useJWT
                ? {
                    jwtAlgorithm: settings.jwtAlgorithm,
                    jwtKey: settings.jwtKey,
                    jwtExpDuration: settings.jwtExpDuration,
                    jwtKid: settings.jwtKid,
                    jwtSub: settings.jwtSub,
                    type: "jwt",
                }
                : {
                    username: settings.couchDB_USER,
                    password: settings.couchDB_PASSWORD,
                    type: "basic",
                }
        ) satisfies CouchDBCredentials;
        const authHeader = await (new AuthorizationHeaderGenerator().getAuthorizationHeader(auth));
        const remote =
            settings.couchDB_URI.replace(/\/+$/, "") +
            (settings.couchDB_DBNAME == "" ? "" : "/" + settings.couchDB_DBNAME);
        //
        const ret = fetchChangesForInitialSync(
            dummyLocalDatabase,
            remote,
            authHeader,
            enc.outgoing,
            "0",
            (progress) => {
                Logger(`Initial sync progress: ${progress.totalValidFetched} / ${progress.docsToFetch}
Total bytes fetched: ${sizeToHumanReadable(progress.totalBytes)}`,
                    LOG_LEVEL_NOTICE, "fetch-init-progress"
                );

            }
        );
        await ret;

        const allDocs = await dummyLocalDatabase.allDocs({ include_docs: false });
        Logger(`Bulk copy test completed. Total documents in local database: ${allDocs.total_rows}`, LOG_LEVEL_NOTICE, "fetch-init-complete");
        await dummyLocalDatabase.destroy();
        Logger(`Dummy local database has been destroyed after test.`, LOG_LEVEL_NOTICE);
    }
    async _everyOnLayoutReady(): Promise<boolean> {

        this.addCommand({
            "id": "bulk-copy-test",
            "name": "(DEBUG) Bulk copy test",
            "callback": async () => {
                await this._runBulkCopyTest();
            }
        })

        if (!this.settings.enableDebugTools) return Promise.resolve(true);
        // if (await this.core.storageAccess.isExistsIncludeHidden("_SHOWDIALOGAUTO.md")) {
        //     void this.core.$$showView(VIEW_TYPE_TEST);
        // }

        this.addCommand({
            id: "test-create-conflict",
            name: "Create conflict",
            callback: async () => {
                const filename = "test-create-conflict.md";
                const content = `# Test create conflict\n\n`;
                const w = await this.core.databaseFileAccess.store({
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
                    const id = await this.services.path.path2id(filename as FilePathWithPrefix);
                    const f = await this.core.localDatabase.getRaw(id);
                    console.log(f);
                    console.log(f._rev);
                    const revConflict = f._rev.split("-")[0] + "-" + (parseInt(f._rev.split("-")[1]) + 1).toString();
                    console.log(await this.core.localDatabase.bulkDocsRaw([f], { new_edits: false }));
                    console.log(
                        await this.core.localDatabase.bulkDocsRaw([{ ...f, _rev: revConflict }], { new_edits: false })
                    );
                }
            },
        });
        await delay(1);
        return true;
    }
    testResults = writable<[boolean, string, string][]>([]);
    // testResults: string[] = [];

    private _addTestResult(name: string, key: string, result: boolean, summary?: string, message?: string): void {
        const logLine = `${name}: ${key} ${summary ?? ""}`;
        this.testResults.update((results) => {
            results.push([result, logLine, message ?? ""]);
            return results;
        });
    }
    private _everyModuleTest(): Promise<boolean> {
        if (!this.settings.enableDebugTools) return Promise.resolve(true);
        // this.core.$$addTestResult("DevModule", "Test", true);
        // return Promise.resolve(true);
        // this.addTestResult("Test of test1", true, "Just OK", "This is a test of test");
        // this.addTestResult("Test of test2", true, "Just OK?");
        // this.addTestResult("Test of test3", true);
        return this.testDone();
    }
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onLayoutReady.addHandler(this._everyOnLayoutReady.bind(this));
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
        services.appLifecycle.onSettingLoaded.addHandler(this._everyOnloadAfterLoadSettings.bind(this));
        services.test.test.addHandler(this._everyModuleTest.bind(this));
        services.test.addTestResult.setHandler(this._addTestResult.bind(this));
    }
}
