import { fireAndForget } from "octagonal-wheels/promises";
import { __onMissingTranslation } from "../../lib/src/common/i18n";
import { AbstractObsidianModule, type IObsidianModule } from "../AbstractObsidianModule.ts";
import { LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { eventHub } from "../../common/events";
import { enableTestFunction } from "./devUtil/testUtils.ts";
import { TestPaneView, VIEW_TYPE_TEST } from "./devUtil/TestPaneView.ts";
import { writable } from "svelte/store";

export class ModuleDev extends AbstractObsidianModule implements IObsidianModule {
    $everyOnloadStart(): Promise<boolean> {
        __onMissingTranslation(() => {});
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

    $everyOnloadAfterLoadSettings(): Promise<boolean> {
        if (!this.settings.enableDebugTools) return Promise.resolve(true);
        // eslint-disable-next-line no-unused-labels
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
                void this.core.$$showView(VIEW_TYPE_TEST);
            },
        });
        return Promise.resolve(true);
    }
    async $everyOnLayoutReady(): Promise<boolean> {
        if (!this.settings.enableDebugTools) return Promise.resolve(true);
        if (await this.core.storageAccess.isExistsIncludeHidden("_SHOWDIALOGAUTO.md")) {
            void this.core.$$showView(VIEW_TYPE_TEST);
        }
        return true;
    }
    testResults = writable<[boolean, string, string][]>([]);
    // testResults: string[] = [];

    $$addTestResult(name: string, key: string, result: boolean, summary?: string, message?: string): void {
        const logLine = `${name}: ${key} ${summary ?? ""}`;
        this.testResults.update((results) => {
            results.push([result, logLine, message ?? ""]);
            return results;
        });
    }
    $everyModuleTest(): Promise<boolean> {
        if (!this.settings.enableDebugTools) return Promise.resolve(true);
        // this.core.$$addTestResult("DevModule", "Test", true);
        // return Promise.resolve(true);
        // this.addTestResult("Test of test1", true, "Just OK", "This is a test of test");
        // this.addTestResult("Test of test2", true, "Just OK?");
        // this.addTestResult("Test of test3", true);
        return this.testDone();
    }
}
