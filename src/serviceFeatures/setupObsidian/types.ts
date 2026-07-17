import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";

export type SetupFeatureHost = NecessaryServices<"API" | "UI" | "setting", never>;
