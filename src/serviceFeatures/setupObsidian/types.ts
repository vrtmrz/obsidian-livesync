import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule.js";

export type SetupFeatureHost = NecessaryServices<"API" | "UI" | "setting", never>;
