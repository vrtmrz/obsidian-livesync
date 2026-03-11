import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, Logger } from "octagonal-wheels/common/logger";
import type { AnyEntry, FilePathWithPrefix } from "@lib/common/types";
import type { IMinimumLiveSyncCommands, LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { stripAllPrefixes } from "@lib/string_and_binary/path";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils";
import type { ServiceContext } from "@/lib/src/services/base/ServiceBase";

export abstract class AbstractModule<
    T extends LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands> = LiveSyncBaseCore<
        ServiceContext,
        IMinimumLiveSyncCommands
    >,
> {
    _log = createInstanceLogFunction(this.constructor.name, this.services.API);
    get services() {
        if (!this.core._services) {
            throw new Error("Services are not ready yet.");
        }
        return this.core._services;
    }

    addCommand = this.services.API.addCommand.bind(this.services.API);
    registerView = this.services.API.registerWindow.bind(this.services.API);
    addRibbonIcon = this.services.API.addRibbonIcon.bind(this.services.API);
    registerObsidianProtocolHandler = this.services.API.registerProtocolHandler.bind(this.services.API);

    get localDatabase() {
        return this.core.localDatabase;
    }
    get settings() {
        return this.core.settings;
    }
    set settings(value) {
        this.core.settings = value;
    }

    getPath(entry: AnyEntry): FilePathWithPrefix {
        return this.services.path.getPath(entry);
    }

    getPathWithoutPrefix(entry: AnyEntry): FilePathWithPrefix {
        return stripAllPrefixes(this.services.path.getPath(entry));
    }

    onBindFunction(core: T, services: typeof core.services) {
        // Override if needed.
    }
    constructor(public core: T) {
        Logger(`[${this.constructor.name}] Loaded`, LOG_LEVEL_VERBOSE);
    }
    saveSettings = this.core.services.setting.saveSettingData.bind(this.core.services.setting);

    addTestResult(key: string, value: boolean, summary?: string, message?: string) {
        this.services.test.addTestResult(`${this.constructor.name}`, key, value, summary, message);
    }
    testDone(result: boolean = true) {
        return Promise.resolve(result);
    }
    testFail(message: string) {
        this._log(message, LOG_LEVEL_NOTICE);
        return this.testDone(false);
    }

    async _test(key: string, process: () => Promise<any>) {
        this._log(`Testing ${key}`, LOG_LEVEL_VERBOSE);
        try {
            const ret = await process();
            if (ret !== true) {
                this.addTestResult(key, false, ret.toString());
                return this.testFail(`${key} failed: ${ret}`);
            }
            this.addTestResult(key, true, "");
        } catch (ex: any) {
            this.addTestResult(key, false, "Failed by Exception", ex.toString());
            return this.testFail(`${key} failed: ${ex}`);
        }
        return this.testDone();
    }

    isMainReady() {
        return this.services.appLifecycle.isReady();
    }
    isMainSuspended() {
        return this.services.appLifecycle.isSuspended();
    }
    isDatabaseReady() {
        return this.services.database.isDatabaseReady();
    }
}
