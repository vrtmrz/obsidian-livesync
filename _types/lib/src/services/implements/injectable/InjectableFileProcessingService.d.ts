import { FileProcessingService } from "@lib/services/base/FileProcessingService";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
export declare class InjectableFileProcessingService<T extends ServiceContext> extends FileProcessingService<T> {
}
