// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { LogFunction } from "@lib/services/lib/logUtils";
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import type { SetupFeatureHost } from "./types";
export declare function askEncryptingPassphrase(host: SetupFeatureHost): Promise<string | false>;
export declare function copySetupURI(host: SetupFeatureHost, log: LogFunction, stripExtra?: boolean): Promise<void>;
export declare function copySetupURIFull(host: SetupFeatureHost, log: LogFunction): Promise<void>;
export declare function useSetupURIFeature(host: NecessaryServices<"API" | "UI" | "setting" | "appLifecycle", never>): void;
