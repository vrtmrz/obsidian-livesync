import { defineConfig, mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import viteConfig from "./vitest.config.common";
import dotenv from "dotenv";
import { grantClipboardPermissions, openWebPeer, closeWebPeer, acceptWebPeer } from "./test/lib/commands";
const defEnv = dotenv.config({ path: ".env" }).parsed;
const testEnv = dotenv.config({ path: ".test.env" }).parsed;
const env = Object.assign({}, defEnv, testEnv);
const debuggerEnabled = env?.ENABLE_DEBUGGER === "true";
const enableUI = env?.ENABLE_UI === "true";
const headless = !debuggerEnabled && !enableUI;
export default mergeConfig(
    viteConfig,
    defineConfig({
        test: {
            env: env,
            testTimeout: 40000,
            hookTimeout: 50000,
            fileParallelism: false,
            isolate: true,
            watch: false,

            // environment: "browser",
            include: ["test/**/*.test.ts"],
            coverage: {
                include: ["src/**/*.ts", "src/lib/src/**/*.ts", "src/**/*.svelte"],
                exclude: ["**/*.test.ts", "src/lib/**"],
                provider: "v8",
                reporter: ["text", "json", "html"],
                // ignoreEmptyLines: true,
            },
            browser: {
                isolate: true,
                commands: {
                    grantClipboardPermissions,
                    openWebPeer,
                    closeWebPeer,
                    acceptWebPeer,
                },
                provider: playwright({
                    launchOptions: {
                        args: ["--js-flags=--expose-gc"],
                        // chromiumSandbox: true,
                    },
                }),
                enabled: true,
                screenshotFailures: false,
                instances: [
                    {
                        execArgv: ["--js-flags=--expose-gc"],
                        browser: "chromium",
                        headless,
                        isolate: true,
                        inspector: debuggerEnabled
                            ? {
                                  waitForDebugger: true,
                                  enabled: true,
                              }
                            : undefined,
                        printConsoleTrace: debuggerEnabled,
                        onUnhandledError(error) {
                            // Ignore certain errors
                            const msg = error.message || "";
                            if (msg.includes("Cannot create so many PeerConnections")) {
                                return false;
                            }
                        },
                    },
                ],
                headless,
                fileParallelism: false,
                ui: debuggerEnabled || enableUI ? true : false,
            },
        },
    })
);
