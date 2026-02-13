import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, Logger } from "octagonal-wheels/common/logger";
import type { AnyEntry, FilePathWithPrefix, LOG_LEVEL } from "@lib/common/types";
import type { LiveSyncCore } from "@/main";
import { __$checkInstanceBinding } from "@lib/dev/checks";
import { stripAllPrefixes } from "@lib/string_and_binary/path";

export abstract class AbstractModule {
    _log = (msg: any, level: LOG_LEVEL = LOG_LEVEL_INFO, key?: string) => {
        if (typeof msg === "string" && level !== LOG_LEVEL_NOTICE) {
            msg = `[${this.constructor.name}]\u{200A} ${msg}`;
        }
        // console.log(msg);
        Logger(msg, level, key);
    };

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

    onBindFunction(core: LiveSyncCore, services: typeof core.services) {
        // Override if needed.
    }
    constructor(public core: LiveSyncCore) {
        this.onBindFunction(core, core.services);
        Logger(`[${this.constructor.name}] Loaded`, LOG_LEVEL_VERBOSE);
        __$checkInstanceBinding(this);
    }
    saveSettings = this.core.saveSettings.bind(this.core);

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

    get services() {
        return this.core._services;
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
