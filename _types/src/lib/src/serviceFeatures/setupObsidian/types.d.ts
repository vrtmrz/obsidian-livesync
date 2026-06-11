import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
export type SetupFeatureHost = NecessaryServices<"API" | "UI" | "setting", never>;
