// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 6de1db1
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
export type SetupFeatureHost = NecessaryServices<"API" | "UI" | "setting", never>;
