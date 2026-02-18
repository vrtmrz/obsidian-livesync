import type { TAbstractFile, TFile, TFolder, Stat } from "@/deps";

import { ServiceFileAccessBase } from "@lib/serviceModules/ServiceFileAccessBase";

// For typechecking purpose
export class ServiceFileAccessObsidian extends ServiceFileAccessBase<TAbstractFile, TFile, TFolder, Stat> {}
