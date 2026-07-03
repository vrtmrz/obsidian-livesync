// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { IConfigService } from "@lib/services/base/IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
export declare abstract class ConfigService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IConfigService {
    abstract getSmallConfig(key: string): string | null;
    abstract setSmallConfig(key: string, value: string): void;
    abstract deleteSmallConfig(key: string): void;
}
