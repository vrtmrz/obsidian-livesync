// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { LogFunction } from "@lib/services/lib/logUtils";
import type { SetupFeatureHost } from "@lib/serviceFeatures/setupObsidian/types";
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import { type SetupManager } from "@/modules/features/SetupManager";
export declare function registerSetupProtocolHandler(host: SetupFeatureHost, log: LogFunction, setupManager: SetupManager): void;
export declare function useSetupProtocolFeature(host: NecessaryServices<"API" | "UI" | "setting" | "appLifecycle", never>, setupManager: SetupManager): void;
