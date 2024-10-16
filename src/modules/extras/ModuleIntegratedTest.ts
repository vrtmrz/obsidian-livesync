import { delay } from "octagonal-wheels/promises";
import { LOG_LEVEL_NOTICE, REMOTE_MINIO, type FilePathWithPrefix } from "src/lib/src/common/types";
import { shareRunningResult } from "octagonal-wheels/concurrency/lock";
import { AbstractObsidianModule, type IObsidianModule } from "../AbstractObsidianModule";

export class ModuleIntegratedTest extends AbstractObsidianModule implements IObsidianModule {

    async waitFor(proc: () => Promise<boolean>, timeout = 10000): Promise<boolean> {
        await delay(100);
        const start = Date.now();
        while (!await proc()) {
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
    waitWithReplicating(proc: () => Promise<boolean>, timeout = 10000): Promise<boolean> {
        return this.waitFor(async () => {
            await this.tryReplicate();
            return await proc();
        }, timeout);
    }
    async storageContentIsEqual(file: string, content: string): Promise<boolean> {
        try {
            const fileContent = await this.readStorageContent(file as FilePathWithPrefix);
            if (fileContent === content) {
                return true;
            } else {
                // this._log(`Content is not same \n Expected:${content}\n Actual:${fileContent}`, LOG_LEVEL_VERBOSE);
                return false;
            }
        } catch (e) {
            this._log(`Error: ${e}`);
            return false;
        }
    }
    async assert(proc: () => Promise<boolean>): Promise<boolean> {
        if (!await proc()) {
            this._log(`Assertion failed`);
            return false;
        }
        return true;
    }
    async _orDie(key: string, proc: () => Promise<boolean>): Promise<true> | never {
        if (!await this._test(key, proc)) {
            throw new Error(`${key}`);
        }
        return true;
    }
    tryReplicate() {
        if (!this.settings.liveSync) {
            return shareRunningResult("replicate-test", async () => { await this.core.$$replicate() });
        }
    }
    async readStorageContent(file: FilePathWithPrefix): Promise<string | undefined> {
        if (!await this.core.storageAccess.isExistsIncludeHidden(file)) {
            return undefined;
        }
        return await this.core.storageAccess.readHiddenFileText(file);
    }
    async _proceed(no: number, title: string): Promise<boolean> {
        const stepFile = "_STEP.md" as FilePathWithPrefix;
        const stepAckFile = "_STEP_ACK.md" as FilePathWithPrefix;
        const stepContent = `Step ${no}`;
        await this.core.$anyResolveConflictByNewest(stepFile);
        await this.core.storageAccess.writeFileAuto(stepFile, stepContent);
        await this._orDie(`Wait for acknowledge ${no}`, async () => {
            if (!await this.waitWithReplicating(
                async () => {
                    return await this.storageContentIsEqual(stepAckFile, stepContent)
                }, 20000)
            ) return false;
            return true;
        })
        return true;
    }
    async _join(no: number, title: string): Promise<boolean> {
        const stepFile = "_STEP.md" as FilePathWithPrefix;
        const stepAckFile = "_STEP_ACK.md" as FilePathWithPrefix;
        // const otherStepFile = `_STEP_${isLeader ? "R" : "L"}.md` as FilePathWithPrefix;
        const stepContent = `Step ${no}`;

        await this._orDie(`Wait for step ${no} (${title})`, async () => {
            if (!await this.waitWithReplicating(
                async () => {
                    return await this.storageContentIsEqual(stepFile, stepContent)
                }, 20000)
            ) return false;
            return true;
        }
        )
        await this.core.$anyResolveConflictByNewest(stepAckFile);
        await this.core.storageAccess.writeFileAuto(stepAckFile, stepContent);
        await this.tryReplicate();
        return true;
    }

    async performStep({
        step,
        title,
        isGameChanger,
        proc,
        check
    }: {
        step: number,
        title: string,
        isGameChanger: boolean,
        proc: () => Promise<any>,
        check: () => Promise<boolean>,
    }): Promise<boolean> {
        if (isGameChanger) {
            await this._proceed(step, title);
            try {
                await proc();
            } catch (e) {
                this._log(`Error: ${e}`);
                return false;
            }
            return await this._orDie(`Step ${step} - ${title}`,
                async () => await this.waitWithReplicating(check)
            );
        } else {
            return await this._join(step, title);
        }
    }
    // // see scenario.md
    // async testLeader(testMain: (testFileName: FilePathWithPrefix) => Promise<boolean>): Promise<boolean> {

    // }
    // async testReceiver(testMain: (testFileName: FilePathWithPrefix) => Promise<boolean>): Promise<boolean> {

    // }
    async nonLiveTestRunner(isLeader: boolean, testMain: (testFileName: FilePathWithPrefix, isLeader: boolean) => Promise<boolean>): Promise<boolean> {
        const storage = this.core.storageAccess;
        // const database = this.core.databaseFileAccess;
        // const _orDie = this._orDie.bind(this);
        const testCommandFile = "IT.md" as FilePathWithPrefix;
        const textCommandResponseFile = "ITx.md" as FilePathWithPrefix;
        let testFileName: FilePathWithPrefix;
        this.addTestResult("-------Starting ... ", true, `Test as ${isLeader ? "Leader" : "Receiver"} command file ${testCommandFile}`);
        if (isLeader) {
            await this._proceed(0, "start");
        }
        await this.tryReplicate();

        await this.performStep({
            step: 0,
            title: "Make sure that command File Not Exists",
            isGameChanger: isLeader,
            proc: async () => await storage.removeHidden(testCommandFile),
            check: async () => !(await storage.isExistsIncludeHidden(testCommandFile)),
        })
        await this.performStep({
            step: 1,
            title: "Make sure that command File Not Exists On Receiver",
            isGameChanger: !isLeader,
            proc: async () => await storage.removeHidden(textCommandResponseFile),
            check: async () => !(await storage.isExistsIncludeHidden(textCommandResponseFile)),
        })

        await this.performStep({
            step: 2,
            title: "Decide the test file name",
            isGameChanger: isLeader,
            proc: async () => {
                testFileName = (Date.now() + "-" + Math.ceil(Math.random() * 1000) + ".md") as FilePathWithPrefix;
                const testCommandFile = "IT.md" as FilePathWithPrefix;
                await storage.writeFileAuto(testCommandFile, testFileName);
            },
            check: () => Promise.resolve(true),
        })
        await this.performStep({
            step: 3,
            title: "Wait for the command file to be arrived",
            isGameChanger: !isLeader,
            proc: async () => { },
            check: async () => await storage.isExistsIncludeHidden(testCommandFile),
        })

        await this.performStep({
            step: 4,
            title: "Send the response file",
            isGameChanger: !isLeader,
            proc: async () => {
                await storage.writeHiddenFileAuto(textCommandResponseFile, "!");
            },
            check: () => Promise.resolve(true),
        })
        await this.performStep({
            step: 5,
            title: "Wait for the response file to be arrived",
            isGameChanger: isLeader,
            proc: async () => { },
            check: async () => await storage.isExistsIncludeHidden(textCommandResponseFile),
        })

        await this.performStep({
            step: 6,
            title: "Proceed to begin the test",
            isGameChanger: isLeader,
            proc: async () => {

            },
            check: () => Promise.resolve(true),
        });
        await this.performStep({
            step: 6,
            title: "Begin the test",
            isGameChanger: !false,
            proc: async () => {
            },
            check: () => {
                return Promise.resolve(true);
            },
        })
        // await this.step(0, isLeader, true);
        try {
            this.addTestResult("** Main------", true, ``);
            if (isLeader) {
                return await testMain(testFileName!, true);
            } else {
                const testFileName = await this.readStorageContent(testCommandFile);
                this.addTestResult("testFileName", true, `Request client to use :${testFileName!}`);
                return await testMain(testFileName! as FilePathWithPrefix, false);
            }
        } finally {
            this.addTestResult("Teardown", true, `Deleting ${testFileName!}`);
            await storage.removeHidden(testFileName!);
        }

        return true;
        // Make sure the 
    }


    async testBasic(filename: FilePathWithPrefix, isLeader: boolean): Promise<boolean> {
        const storage = this.core.storageAccess;
        const database = this.core.databaseFileAccess;

        await this.addTestResult(`---**Starting Basic Test**---`, true, `Test as ${isLeader ? "Leader" : "Receiver"} command file ${filename}`);
        // if (isLeader) {
        //     await this._proceed(0);
        // }
        // await this.tryReplicate();

        await this.performStep({
            step: 0,
            title: "Make sure that file is not exist",
            isGameChanger: !isLeader,
            proc: async () => { },
            check: async () => !(await storage.isExists(filename)),
        })


        await this.performStep({
            step: 1,
            title: "Write a file",
            isGameChanger: isLeader,
            proc: async () => await storage.writeFileAuto(filename, "Hello World"),
            check: async () => await storage.isExists(filename),
        })
        await this.performStep({
            step: 2,
            title: "Make sure the file is arrived",
            isGameChanger: !isLeader,
            proc: async () => { },
            check: async () => await storage.isExists(filename),
        })
        await this.performStep({
            step: 3,
            title: "Update to Hello World 2",
            isGameChanger: isLeader,
            proc: async () => await storage.writeFileAuto(filename, "Hello World 2"),
            check: async () => await this.storageContentIsEqual(filename, "Hello World 2"),
        })
        await this.performStep({
            step: 4,
            title: "Make sure the modified file is arrived",
            isGameChanger: !isLeader,
            proc: async () => { },
            check: async () => await this.storageContentIsEqual(filename, "Hello World 2"),
        })
        await this.performStep({
            step: 5,
            title: "Update to Hello World 3",
            isGameChanger: !isLeader,
            proc: async () => await storage.writeFileAuto(filename, "Hello World 3"),
            check: async () => await this.storageContentIsEqual(filename, "Hello World 3"),
        })
        await this.performStep({
            step: 6,
            title: "Make sure the modified file is arrived",
            isGameChanger: isLeader,
            proc: async () => { },
            check: async () => await this.storageContentIsEqual(filename, "Hello World 3"),
        })

        const multiLineContent = `Line1:A
Line2:B
Line3:C
Line4:D`

        await this.performStep({
            step: 7,
            title: "Update to Multiline",
            isGameChanger: isLeader,
            proc: async () => await storage.writeFileAuto(filename, multiLineContent),
            check: async () => await this.storageContentIsEqual(filename, multiLineContent),
        })

        await this.performStep({
            step: 8,
            title: "Make sure the modified file is arrived",
            isGameChanger: !isLeader,
            proc: async () => { },
            check: async () => await this.storageContentIsEqual(filename, multiLineContent),
        })

        // While LiveSync, possibly cannot cause the conflict.
        if (!this.settings.liveSync) {



            // Step 9 Make Conflict But Resolvable
            const multiLineContentL = `Line1:A
Line2:B
Line3:C!
Line4:D`
            const multiLineContentC = `Line1:A
Line2:bbbbb
Line3:C
Line4:D`

            await this.performStep({
                step: 9,
                title: "Progress to be conflicted",
                isGameChanger: isLeader,
                proc: async () => { },
                check: () => Promise.resolve(true),
            })

            await storage.writeFileAuto(filename, isLeader ? multiLineContentL : multiLineContentC);

            await this.performStep({
                step: 10,
                title: "Update As Conflicted",
                isGameChanger: !isLeader,
                proc: async () => { },
                check: () => Promise.resolve(true),
            })

            await this.performStep({
                step: 10,
                title: "Make sure Automatically resolved",
                isGameChanger: isLeader,
                proc: async () => { },
                check: async () => (await database.getConflictedRevs(filename)).length === 0,
            })
            await this.performStep({
                step: 11,
                title: "Make sure Automatically resolved",
                isGameChanger: !isLeader,
                proc: async () => { },
                check: async () => (await database.getConflictedRevs(filename)).length === 0,
            })



            const sensiblyMergedContent = `Line1:A
Line2:bbbbb
Line3:C!
Line4:D`

            await this.performStep({
                step: 12,
                title: "Make sure Sensibly Merged on Leader",
                isGameChanger: isLeader,
                proc: async () => { },
                check: async () => await this.storageContentIsEqual(filename, sensiblyMergedContent),
            })
            await this.performStep({
                step: 13,
                title: "Make sure Sensibly Merged on Receiver",
                isGameChanger: !isLeader,
                proc: async () => { },
                check: async () => await this.storageContentIsEqual(filename, sensiblyMergedContent),
            })
        }
        await this.performStep({
            step: 14,
            title: "Delete File",
            isGameChanger: isLeader,
            proc: async () => { await storage.removeHidden(filename) },
            check: async () => !await storage.isExists(filename),
        })

        await this.performStep({
            step: 15,
            title: "Make sure File is deleted",
            isGameChanger: !isLeader,
            proc: async () => { },
            check: async () => !await storage.isExists(filename),
        })
        this._log(`The Basic Test has been completed`, LOG_LEVEL_NOTICE);
        return true;
    }

    async testBasicEvent(isLeader: boolean) {
        this.settings.liveSync = false;
        await this.saveSettings();
        await this._test("basic", async () => await this.nonLiveTestRunner(isLeader, (t, l) => this.testBasic(t, l)));
    }
    async testBasicLive(isLeader: boolean) {
        this.settings.liveSync = true;
        await this.saveSettings();
        await this._test("basic", async () => await this.nonLiveTestRunner(isLeader, (t, l) => this.testBasic(t, l)));
    }

    async $everyModuleTestMultiDevice(): Promise<boolean> {
        if (!this.settings.enableDebugTools) return Promise.resolve(true);
        const isLeader = this.core.$$vaultName().indexOf("recv") === -1;
        this.addTestResult("-------", true, `Test as ${isLeader ? "Leader" : "Receiver"}`);
        try {
            this._log(`Starting Test`);
            await this.testBasicEvent(isLeader);
            if (this.settings.remoteType == REMOTE_MINIO) await this.testBasicLive(isLeader);

        } catch (e) {
            this._log(e)
            this._log(`Error: ${e}`);
            return Promise.resolve(false);
        }

        return Promise.resolve(true);
    }
}