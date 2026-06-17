import { ServiceFileAccessBase } from "@lib/serviceModules/ServiceFileAccessBase";
import type { ObsidianFileSystemAdapter } from "./FileSystemAdapters/ObsidianFileSystemAdapter";

// For now, this is just a re-export of ServiceFileAccess with the Obsidian-specific adapter type.
export class ServiceFileAccessObsidian extends ServiceFileAccessBase<ObsidianFileSystemAdapter> {}
