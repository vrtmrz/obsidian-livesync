import { mergeConfig } from "vite";
import { fileURLToPath } from "node:url";
import common from "../../vitest.config.common.ts";

const config = mergeConfig(common, {
    optimizeDeps: {
        entries: [
            "test/p2p-diagnostics/log-pane/index.html",
            "test/p2p-diagnostics/status-card/index.html",
            "test/p2p-diagnostics/status-pane/index.html",
        ],
    },
    server: { host: "127.0.0.1", port: 5157, strictPort: true },
});
config.resolve.alias = {
    "@/modules/features/Log/LogPaneView": fileURLToPath(new URL("./log-pane-view.ts", import.meta.url)),
    "@/deps": fileURLToPath(new URL("./host-ui.ts", import.meta.url)),
    "@/modules/features/SetupManager": fileURLToPath(new URL("./host-ui.ts", import.meta.url)),
    ...common.resolve.alias,
};
export default config;
