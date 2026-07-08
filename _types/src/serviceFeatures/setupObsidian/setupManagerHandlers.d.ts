// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type SetupManager } from "@/modules/features/SetupManager";
import type { SetupFeatureHost } from "@lib/serviceFeatures/setupObsidian/types";
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
export declare function openSetupURI(setupManager: SetupManager): Promise<void>;
export declare function openP2PSettings(host: SetupFeatureHost, setupManager: SetupManager): Promise<boolean>;
export declare function useSetupManagerHandlersFeature(host: NecessaryServices<"API" | "UI" | "setting" | "appLifecycle", never>, setupManager: SetupManager): void;
