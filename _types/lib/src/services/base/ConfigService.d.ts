import type { IConfigService } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
export declare abstract class ConfigService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IConfigService {
    abstract getSmallConfig(key: string): string | null;
    abstract setSmallConfig(key: string, value: string): void;
    abstract deleteSmallConfig(key: string): void;
}
