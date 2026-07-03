// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { APIService } from "@lib/services/base/APIService";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils";
export interface ServiceModuleBaseDependencies {
    API: APIService;
}
export declare abstract class ServiceModuleBase<T extends ServiceModuleBaseDependencies> {
    _log: ReturnType<typeof createInstanceLogFunction>;
    get name(): string;
    constructor(services: T);
}
