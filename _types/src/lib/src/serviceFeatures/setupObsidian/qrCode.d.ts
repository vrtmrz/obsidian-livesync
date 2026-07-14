// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 05d4714
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import type { SetupFeatureHost } from "./types";
export declare function encodeSetupSettingsAsQR(host: SetupFeatureHost): Promise<string>;
export declare function useSetupQRCodeFeature(host: NecessaryServices<"API" | "UI" | "setting" | "appLifecycle", never>): void;
