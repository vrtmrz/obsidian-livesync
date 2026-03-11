import { ServiceFileAccessBase, type StorageAccessBaseDependencies } from "@lib/serviceModules/ServiceFileAccessBase";
import { NodeFileSystemAdapter } from "../adapters/NodeFileSystemAdapter";

/**
 * CLI-specific implementation of ServiceFileAccess
 * Uses NodeFileSystemAdapter for platform-specific operations
 */
export class ServiceFileAccessCLI extends ServiceFileAccessBase<NodeFileSystemAdapter> {
    constructor(services: StorageAccessBaseDependencies<NodeFileSystemAdapter>) {
        super(services);
    }
}
