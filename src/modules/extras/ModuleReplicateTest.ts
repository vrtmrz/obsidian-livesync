import { delay } from "octagonal-wheels/promises";
import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { eventHub } from "../../common/events";
import { getWebCrypto } from "../../lib/src/mods.ts";
import { uint8ArrayToHexString } from "octagonal-wheels/binary/hex";
import { parseYaml, requestUrl, stringifyYaml } from "@/deps.ts";
import type { FilePath } from "../../lib/src/common/types.ts";
import { scheduleTask } from "octagonal-wheels/concurrency/task";
import { getFileRegExp } from "../../lib/src/common/utils.ts";
import type { LiveSyncCore } from "../../main.ts";

declare global {
    interface LSEvents {
        "debug-sync-status": string[];
    }
}

export class ModuleReplicateTest extends AbstractObsidianModule {
    testRootPath = "_test/";
    testInfoPath = "_testinfo/";

    get isLeader() {
        return (
            this.services.vault.getVaultName().indexOf("dev") >= 0 &&
            this.services.vault.vaultName().indexOf("recv") < 0
        );
    }

    get nameByKind() {
        if (!this.isLeader) {
            return "RECV";
        } else if (this.isLeader) {
            return "LEADER";
        }
    }
    get pairName() {
        if (this.isLeader) {
            return "RECV";
        } else if (!this.isLeader) {
            return "LEADER";
        }
    }

    watchIsSynchronised = false;

    statusBarSyncStatus?: HTMLElement;
    async readFileContent(file: string) {
        try {
            return await this.core.storageAccess.readHiddenFileText(file);
        } catch {
            return "";
        }
    }

    async dumpList() {
        if (this.settings.syncInternalFiles) {
            this._log("Write file list (Include Hidden)");
            await this.__dumpFileListIncludeHidden("files.md");
        } else {
            this._log("Write file list");
            await this.__dumpFileList("files.md");
        }
    }
    async _everyBeforeReplicate(showMessage: boolean): Promise<boolean> {
        if (!this.settings.enableDebugTools) return Promise.resolve(true);
        await this.dumpList();
        return true;
    }
    private _everyOnloadAfterLoadSettings(): Promise<boolean> {
        if (!this.settings.enableDebugTools) return Promise.resolve(true);
        this.addCommand({
            id: "dump-file-structure-normal",
            name: `Dump Structure (Normal)`,
            callback: () => {
                void this.__dumpFileList("files.md").finally(() => {
                    void this.refreshSyncStatus();
                });
            },
        });
        this.addCommand({
            id: "dump-file-structure-ih",
            name: "Dump Structure (Include Hidden)",
            callback: () => {
                const d = "files.md";
                void this.__dumpFileListIncludeHidden(d);
            },
        });
        this.addCommand({
            id: "dump-file-structure-auto",
            name: "Dump Structure",
            callback: () => {
                void this.dumpList();
            },
        });
        this.addCommand({
            id: "dump-file-test",
            name: `Perform Test (Dev) ${this.isLeader ? "(Leader)" : "(Recv)"}`,
            callback: () => {
                void this.performTestManually();
            },
        });
        this.addCommand({
            id: "watch-sync-result",
            name: `Watch sync result is matched between devices`,
            callback: () => {
                this.watchIsSynchronised = !this.watchIsSynchronised;
                void this.refreshSyncStatus();
            },
        });
        this.app.vault.on("modify", async (file) => {
            if (file.path.startsWith(this.testInfoPath)) {
                await this.refreshSyncStatus();
            } else {
                scheduleTask("dumpStatus", 125, async () => {
                    await this.dumpList();
                    return true;
                });
            }
        });
        this.statusBarSyncStatus = this.plugin.addStatusBarItem();
        return Promise.resolve(true);
    }
    async getSyncStatusAsText() {
        const fileMine = this.testInfoPath + this.nameByKind + "/" + "files.md";
        const filePair = this.testInfoPath + this.pairName + "/" + "files.md";
        const mine = parseYaml(await this.readFileContent(fileMine));
        const pair = parseYaml(await this.readFileContent(filePair));
        const result = [] as string[];
        if (mine.length != pair.length) {
            result.push(`File count is different: ${mine.length} vs ${pair.length}`);
        }
        const filesAll = new Set([...mine.map((e: any) => e.path), ...pair.map((e: any) => e.path)]);
        for (const file of filesAll) {
            const mineFile = mine.find((e: any) => e.path == file);
            const pairFile = pair.find((e: any) => e.path == file);
            if (!mineFile || !pairFile) {
                result.push(`File not found: ${file}`);
            } else {
                if (mineFile.size != pairFile.size) {
                    result.push(`Size is different: ${file} ${mineFile.size} vs ${pairFile.size}`);
                }
                if (mineFile.hash != pairFile.hash) {
                    result.push(`Hash is different: ${file} ${mineFile.hash} vs ${pairFile.hash}`);
                }
            }
        }
        eventHub.emitEvent("debug-sync-status", result);
        return result.join("\n");
    }

    async refreshSyncStatus() {
        if (this.watchIsSynchronised) {
            // Normal Files
            const syncStatus = await this.getSyncStatusAsText();
            if (syncStatus) {
                this.statusBarSyncStatus!.setText(`Sync Status: Having Error`);
                this._log(`Sync Status: Having Error\n${syncStatus}`, LOG_LEVEL_INFO);
            } else {
                this.statusBarSyncStatus!.setText(`Sync Status: Synchronised`);
            }
        } else {
            this.statusBarSyncStatus!.setText("");
        }
    }

    async __dumpFileList(outFile?: string) {
        if (!this.core || !this.core.storageAccess) {
            this._log("No storage access", LOG_LEVEL_INFO);
            return;
        }
        const files = this.core.storageAccess.getFiles();
        const out = [] as any[];
        const webcrypto = await getWebCrypto();
        for (const file of files) {
            if (!(await this.services.vault.isTargetFile(file.path))) {
                continue;
            }
            if (file.path.startsWith(this.testInfoPath)) continue;
            const stat = await this.core.storageAccess.stat(file.path);
            if (stat) {
                const hashSrc = await this.core.storageAccess.readHiddenFileBinary(file.path);
                const hash = await webcrypto.subtle.digest("SHA-1", hashSrc);
                const hashStr = uint8ArrayToHexString(new Uint8Array(hash));
                const item = {
                    path: file.path,
                    name: file.name,
                    size: stat.size,
                    mtime: stat.mtime,
                    hash: hashStr,
                };
                // const fileLine = `-${file.path}:${stat.size}:${stat.mtime}:${hashStr}`;
                out.push(item);
            }
        }
        out.sort((a, b) => a.path.localeCompare(b.path));
        if (outFile) {
            outFile = this.testInfoPath + this.nameByKind + "/" + outFile;
            await this.core.storageAccess.ensureDir(outFile);
            await this.core.storageAccess.writeHiddenFileAuto(outFile, stringifyYaml(out));
        } else {
            // console.dir(out);
        }
        this._log(`Dumped ${out.length} files`, LOG_LEVEL_INFO);
    }

    async __dumpFileListIncludeHidden(outFile?: string) {
        const ignorePatterns = getFileRegExp(this.plugin.settings, "syncInternalFilesIgnorePatterns");
        const targetPatterns = getFileRegExp(this.plugin.settings, "syncInternalFilesTargetPatterns");
        const out = [] as any[];
        const files = await this.core.storageAccess.getFilesIncludeHidden("", targetPatterns, ignorePatterns);
        // console.dir(files);
        const webcrypto = await getWebCrypto();
        for (const file of files) {
            // if (!await this.core.$$isTargetFile(file)) {
            //     continue;
            // }
            if (file.startsWith(this.testInfoPath)) continue;
            const stat = await this.core.storageAccess.statHidden(file);
            if (stat) {
                const hashSrc = await this.core.storageAccess.readHiddenFileBinary(file);
                const hash = await webcrypto.subtle.digest("SHA-1", hashSrc);
                const hashStr = uint8ArrayToHexString(new Uint8Array(hash));
                const item = {
                    path: file,
                    name: file.split("/").pop(),
                    size: stat.size,
                    mtime: stat.mtime,
                    hash: hashStr,
                };
                // const fileLine = `-${file.path}:${stat.size}:${stat.mtime}:${hashStr}`;
                out.push(item);
            }
        }
        out.sort((a, b) => a.path.localeCompare(b.path));
        if (outFile) {
            outFile = this.testInfoPath + this.nameByKind + "/" + outFile;
            await this.core.storageAccess.ensureDir(outFile);
            await this.core.storageAccess.writeHiddenFileAuto(outFile, stringifyYaml(out));
        } else {
            // console.dir(out);
        }
        this._log(`Dumped ${out.length} files`, LOG_LEVEL_NOTICE);
    }

    async collectTestFiles() {
        const remoteTopDir = "https://raw.githubusercontent.com/vrtmrz/obsidian-livesync/refs/heads/main/";
        const files = [
            "README.md",
            "docs/adding_translations.md",
            "docs/design_docs_of_journalsync.md",
            "docs/design_docs_of_keep_newborn_chunks.md",
            "docs/design_docs_of_prefixed_hidden_file_sync.md",
            "docs/design_docs_of_sharing_tweak_value.md",
            "docs/quick_setup_cn.md",
            "docs/quick_setup_ja.md",
            "docs/quick_setup.md",
            "docs/settings_ja.md",
            "docs/settings.md",
            "docs/setup_cloudant_ja.md",
            "docs/setup_cloudant.md",
            "docs/setup_flyio.md",
            "docs/setup_own_server_cn.md",
            "docs/setup_own_server_ja.md",
            "docs/setup_own_server.md",
            "docs/tech_info_ja.md",
            "docs/tech_info.md",
            "docs/terms.md",
            "docs/troubleshooting.md",
            "images/1.png",
            "images/2.png",
            "images/corrupted_data.png",
            "images/hatch.png",
            "images/lock_pattern1.png",
            "images/lock_pattern2.png",
            "images/quick_setup_1.png",
            "images/quick_setup_2.png",
            "images/quick_setup_3.png",
            "images/quick_setup_3b.png",
            "images/quick_setup_4.png",
            "images/quick_setup_5.png",
            "images/quick_setup_6.png",
            "images/quick_setup_7.png",
            "images/quick_setup_8.png",
            "images/quick_setup_9_1.png",
            "images/quick_setup_9_2.png",
            "images/quick_setup_10.png",
            "images/remote_db_setting.png",
            "images/write_logs_into_the_file.png",
        ];
        for (const file of files) {
            const remote = remoteTopDir + file;
            const local = this.testRootPath + file;
            try {
                const f = (await requestUrl(remote)).arrayBuffer;
                await this.core.storageAccess.ensureDir(local);
                await this.core.storageAccess.writeHiddenFileAuto(local, f);
            } catch (ex) {
                this._log(`Could not fetch ${remote}`, LOG_LEVEL_VERBOSE);
                this._log(ex, LOG_LEVEL_VERBOSE);
            }
        }

        await this.dumpList();
    }

    async waitFor(proc: () => Promise<boolean>, timeout = 10000): Promise<boolean> {
        await delay(100);
        const start = Date.now();
        while (!(await proc())) {
            if (timeout > 0) {
                if (Date.now() - start > timeout) {
                    this._log(`Timeout`);
                    return false;
                }
            }
            await delay(500);
        }
        return true;
    }

    async testConflictedManually1() {
        await this.services.replication.replicate();

        const commonFile = `Resolve! 
*****, the amazing chocolatier!!`;

        if (this.isLeader) {
            await this.core.storageAccess.writeHiddenFileAuto(this.testRootPath + "wonka.md", commonFile);
        }

        await this.services.replication.replicate();
        await this.services.replication.replicate();
        if (
            (await this.core.confirm.askYesNoDialog("Ready to begin the test conflict Manually 1?", {
                timeout: 30,
                defaultOption: "Yes",
            })) == "no"
        ) {
            return;
        }

        const fileA = `Resolve to KEEP THIS
Willy Wonka, Willy Wonka, the amazing chocolatier!!`;

        const fileB = `Resolve to DISCARD THIS
Charlie Bucket, Charlie Bucket, the amazing chocolatier!!`;

        if (this.isLeader) {
            await this.core.storageAccess.writeHiddenFileAuto(this.testRootPath + "wonka.md", fileA);
        } else {
            await this.core.storageAccess.writeHiddenFileAuto(this.testRootPath + "wonka.md", fileB);
        }

        if (
            (await this.core.confirm.askYesNoDialog("Ready to check the result of Manually 1?", {
                timeout: 30,
                defaultOption: "Yes",
            })) == "no"
        ) {
            return;
        }
        await this.services.replication.replicate();
        await this.services.replication.replicate();

        if (
            !(await this.waitFor(async () => {
                await this.services.replication.replicate();
                return (
                    (await this.__assertStorageContent(
                        (this.testRootPath + "wonka.md") as FilePath,
                        fileA,
                        false,
                        true
                    )) == true
                );
            }, 30000))
        ) {
            return await this.__assertStorageContent((this.testRootPath + "wonka.md") as FilePath, fileA, false, true);
        }
        return true;
        // We have to check the result
    }

    async testConflictedManually2() {
        await this.services.replication.replicate();

        const commonFile = `Resolve To concatenate
ABCDEFG`;

        if (this.isLeader) {
            await this.core.storageAccess.writeHiddenFileAuto(this.testRootPath + "concat.md", commonFile);
        }

        await this.services.replication.replicate();
        await this.services.replication.replicate();
        if (
            (await this.core.confirm.askYesNoDialog("Ready to begin the test conflict Manually 2?", {
                timeout: 30,
                defaultOption: "Yes",
            })) == "no"
        ) {
            return;
        }

        const fileA = `Resolve to Concatenate
ABCDEFGHIJKLMNOPQRSTYZ`;

        const fileB = `Resolve to Concatenate
AJKLMNOPQRSTUVWXYZ`;

        const concatenated = `Resolve to Concatenate
ABCDEFGHIJKLMNOPQRSTUVWXYZ`;
        if (this.isLeader) {
            await this.core.storageAccess.writeHiddenFileAuto(this.testRootPath + "concat.md", fileA);
        } else {
            await this.core.storageAccess.writeHiddenFileAuto(this.testRootPath + "concat.md", fileB);
        }
        if (
            (await this.core.confirm.askYesNoDialog("Ready to test conflict Manually 2?", {
                timeout: 30,
                defaultOption: "Yes",
            })) == "no"
        ) {
            return;
        }
        await this.services.replication.replicate();
        await this.services.replication.replicate();

        if (
            !(await this.waitFor(async () => {
                await this.services.replication.replicate();
                return (
                    (await this.__assertStorageContent(
                        (this.testRootPath + "concat.md") as FilePath,
                        concatenated,
                        false,
                        true
                    )) == true
                );
            }, 30000))
        ) {
            return await this.__assertStorageContent(
                (this.testRootPath + "concat.md") as FilePath,
                concatenated,
                false,
                true
            );
        }
        return true;
    }

    async testConflictAutomatic() {
        if (this.isLeader) {
            const baseDoc = `Tasks!
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3
- [ ] Task 4
`;
            await this.core.storageAccess.writeHiddenFileAuto(this.testRootPath + "task.md", baseDoc);
        }
        await delay(100);
        await this.services.replication.replicate();
        await this.services.replication.replicate();

        if (
            (await this.core.confirm.askYesNoDialog("Ready to test conflict?", {
                timeout: 30,
                defaultOption: "Yes",
            })) == "no"
        ) {
            return;
        }
        const mod1Doc = `Tasks!
- [ ] Task 1
- [v] Task 2
- [ ] Task 3
- [ ] Task 4
`;

        const mod2Doc = `Tasks!
- [ ] Task 1
- [ ] Task 2
- [v] Task 3
- [ ] Task 4
`;
        if (this.isLeader) {
            await this.core.storageAccess.writeHiddenFileAuto(this.testRootPath + "task.md", mod1Doc);
        } else {
            await this.core.storageAccess.writeHiddenFileAuto(this.testRootPath + "task.md", mod2Doc);
        }

        await this.services.replication.replicate();
        await this.services.replication.replicate();
        await delay(1000);
        if (
            (await this.core.confirm.askYesNoDialog("Ready to check result?", { timeout: 30, defaultOption: "Yes" })) ==
            "no"
        ) {
            return;
        }
        await this.services.replication.replicate();
        await this.services.replication.replicate();
        const mergedDoc = `Tasks!
- [ ] Task 1
- [v] Task 2
- [v] Task 3
- [ ] Task 4
`;
        return this.__assertStorageContent((this.testRootPath + "task.md") as FilePath, mergedDoc, false, true);
    }

    async checkConflictResolution() {
        this._log("Before testing conflicted files, resolve all once", LOG_LEVEL_NOTICE);
        await this.core.rebuilder.resolveAllConflictedFilesByNewerOnes();
        await this.core.rebuilder.resolveAllConflictedFilesByNewerOnes();
        await this.services.replication.replicate();
        await delay(1000);
        if (!(await this.testConflictAutomatic())) {
            this._log("Conflict resolution (Auto) failed", LOG_LEVEL_NOTICE);
            return false;
        }
        if (!(await this.testConflictedManually1())) {
            this._log("Conflict resolution (Manual1) failed", LOG_LEVEL_NOTICE);
            return false;
        }
        if (!(await this.testConflictedManually2())) {
            this._log("Conflict resolution (Manual2) failed", LOG_LEVEL_NOTICE);
            return false;
        }
        return true;
    }

    async __assertStorageContent(
        fileName: FilePath,
        content: string,
        inverted = false,
        showResult = false
    ): Promise<boolean | string> {
        try {
            const fileContent = await this.core.storageAccess.readHiddenFileText(fileName);
            let result = fileContent === content;
            if (inverted) {
                result = !result;
            }
            if (result) {
                return true;
            } else {
                if (showResult) {
                    this._log(`Content is not same \n Expected:${content}\n Actual:${fileContent}`, LOG_LEVEL_VERBOSE);
                }
                return `Content is not same \n Expected:${content}\n Actual:${fileContent}`;
            }
        } catch (e) {
            this._log(`Cannot assert storage content: ${e}`);
            return false;
        }
    }
    async performTestManually() {
        if (!this.settings.enableDebugTools) return Promise.resolve(true);
        await this.checkConflictResolution();
        // await this.collectTestFiles();
    }

    // testResults = writable<[boolean, string, string][]>([]);
    // testResults: string[] = [];

    // $$addTestResult(name: string, key: string, result: boolean, summary?: string, message?: string): void {
    //     const logLine = `${name}: ${key} ${summary ?? ""}`;
    //     this.testResults.update((results) => {
    //         results.push([result, logLine, message ?? ""]);
    //         return results;
    //     });
    // }
    private async _everyModuleTestMultiDevice(): Promise<boolean> {
        if (!this.settings.enableDebugTools) return Promise.resolve(true);
        // this.core.$$addTestResult("DevModule", "Test", true);
        // return Promise.resolve(true);
        await this._test("Conflict resolution", async () => await this.checkConflictResolution());
        return this.testDone();
    }
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.handleOnSettingLoaded(this._everyOnloadAfterLoadSettings.bind(this));
        services.replication.handleBeforeReplicate(this._everyBeforeReplicate.bind(this));
        services.test.handleTestMultiDevice(this._everyModuleTestMultiDevice.bind(this));
    }
}
