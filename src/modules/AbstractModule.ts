import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, Logger } from "octagonal-wheels/common/logger";
import type { LOG_LEVEL } from "../lib/src/common/types";
import type { LiveSyncCore } from "../main";
// import { unique } from "octagonal-wheels/collection";
// import type { IObsidianModule } from "./AbstractObsidianModule.ts";
// import type {
//     ICoreModuleBase,
//     AllInjectableProps,
//     AllExecuteProps,
//     EveryExecuteProps,
//     AnyExecuteProps,
//     ICoreModule,
// } from "./ModuleTypes";

// function isOverridableKey(key: string): key is keyof ICoreModuleBase {
//     return key.startsWith("$");
// }

// function isInjectableKey(key: string): key is keyof AllInjectableProps {
//     return key.startsWith("$$");
// }

// function isAllExecuteKey(key: string): key is keyof AllExecuteProps {
//     return key.startsWith("$all");
// }
// function isEveryExecuteKey(key: string): key is keyof EveryExecuteProps {
//     return key.startsWith("$every");
// }
// function isAnyExecuteKey(key: string): key is keyof AnyExecuteProps {
//     return key.startsWith("$any");
// }
/**
 * All $prefixed functions are hooked by the modules. Be careful to call them directly.
 * Please refer to the module's source code to understand the function.
 * $$     : Completely overridden functions.
 * $all   : Process all modules and return all results.
 * $every : Process all modules until the first failure.
 * $any   : Process all modules until the first success.
 * $      : Other interceptive points. You should manually assign the module
 * All of above performed on injectModules function.
 */
// export function injectModules<T extends ICoreModule>(target: T, modules: ICoreModule[]) {
//     const allKeys = unique([
//         ...Object.keys(Object.getOwnPropertyDescriptors(target)),
//         ...Object.keys(Object.getOwnPropertyDescriptors(Object.getPrototypeOf(target))),
//     ]).filter((e) => e.startsWith("$")) as (keyof ICoreModule)[];
//     const moduleMap = new Map<string, IObsidianModule[]>();
//     for (const module of modules) {
//         for (const key of allKeys) {
//             if (isOverridableKey(key)) {
//                 if (key in module) {
//                     const list = moduleMap.get(key) || [];
//                     if (typeof module[key] === "function") {
//                         module[key] = module[key].bind(module) as any;
//                     }
//                     list.push(module);
//                     moduleMap.set(key, list);
//                 }
//             }
//         }
//     }
//     Logger(`Injecting modules for ${target.constructor.name}`, LOG_LEVEL_VERBOSE);
//     for (const key of allKeys) {
//         const modules = moduleMap.get(key) || [];
//         if (isInjectableKey(key)) {
//             if (modules.length == 0) {
//                 throw new Error(`No module injected for ${key}. This is a fatal error.`);
//             }
//             target[key] = modules[0][key]! as any;
//             Logger(`[${modules[0].constructor.name}]: Injected ${key} `, LOG_LEVEL_VERBOSE);
//         } else if (isAllExecuteKey(key)) {
//             const modules = moduleMap.get(key) || [];
//             target[key] = async (...args: any) => {
//                 for (const module of modules) {
//                     try {
//                         //@ts-ignore
//                         await module[key]!(...args);
//                     } catch (ex) {
//                         Logger(`[${module.constructor.name}]: All handler for ${key} failed`, LOG_LEVEL_VERBOSE);
//                         Logger(ex, LOG_LEVEL_VERBOSE);
//                     }
//                 }
//                 return true;
//             };
//             for (const module of modules) {
//                 Logger(`[${module.constructor.name}]: Injected (All) ${key} `, LOG_LEVEL_VERBOSE);
//             }
//         } else if (isEveryExecuteKey(key)) {
//             target[key] = async (...args: any) => {
//                 for (const module of modules) {
//                     try {
//                         //@ts-ignore:2556
//                         const ret = await module[key]!(...args);
//                         if (ret !== undefined && !ret) {
//                             // Failed then return that falsy value.
//                             return ret;
//                         }
//                     } catch (ex) {
//                         Logger(`[${module.constructor.name}]: Every handler for ${key} failed`);
//                         Logger(ex, LOG_LEVEL_VERBOSE);
//                     }
//                 }
//                 return true;
//             };
//             for (const module of modules) {
//                 Logger(`[${module.constructor.name}]: Injected (Every) ${key} `, LOG_LEVEL_VERBOSE);
//             }
//         } else if (isAnyExecuteKey(key)) {
//             //@ts-ignore
//             target[key] = async (...args: any[]) => {
//                 for (const module of modules) {
//                     try {
//                         //@ts-ignore:2556
//                         const ret = await module[key](...args);
//                         // If truly value returned, then return that value.
//                         if (ret) {
//                             return ret;
//                         }
//                     } catch (ex) {
//                         Logger(`[${module.constructor.name}]: Any handler for ${key} failed`);
//                         Logger(ex, LOG_LEVEL_VERBOSE);
//                     }
//                 }
//                 return false;
//             };
//             for (const module of modules) {
//                 Logger(`[${module.constructor.name}]: Injected (Any) ${key} `, LOG_LEVEL_VERBOSE);
//             }
//         } else {
//             Logger(`No injected handler for ${key} `, LOG_LEVEL_VERBOSE);
//         }
//     }
//     Logger(`Injected   modules for ${target.constructor.name}`, LOG_LEVEL_VERBOSE);
//     return true;
// }

export abstract class AbstractModule {
    _log = (msg: any, level: LOG_LEVEL = LOG_LEVEL_INFO, key?: string) => {
        if (typeof msg === "string" && level !== LOG_LEVEL_NOTICE) {
            msg = `[${this.constructor.name}]\u{200A} ${msg}`;
        }
        // console.log(msg);
        Logger(msg, level, key);
    };

    get localDatabase() {
        return this.core.localDatabase;
    }
    get settings() {
        return this.core.settings;
    }
    set settings(value) {
        this.core.settings = value;
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services) {
        // Override if needed.
    }
    constructor(public core: LiveSyncCore) {
        this.onBindFunction(core, core.services);
        Logger(`[${this.constructor.name}] Loaded`, LOG_LEVEL_VERBOSE);
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
}
