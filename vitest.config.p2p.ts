import { defineConfig, mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import viteConfig from "./vitest.config.common";
import path from "path";
import dotenv from "dotenv";
import { grantClipboardPermissions, writeHandoffFile, readHandoffFile } from "./test/lib/commands";

const defEnv = dotenv.config({ path: ".env" }).parsed;
const testEnv = dotenv.config({ path: ".test.env" }).parsed;
// Merge: dotenv files < process.env (so shell-injected vars like P2P_TEST_* take precedence)
const p2pEnv: Record<string, string> = {};
if (process.env.P2P_TEST_ROOM_ID) p2pEnv.P2P_TEST_ROOM_ID = process.env.P2P_TEST_ROOM_ID;
if (process.env.P2P_TEST_PASSPHRASE) p2pEnv.P2P_TEST_PASSPHRASE = process.env.P2P_TEST_PASSPHRASE;
if (process.env.P2P_TEST_HOST_PEER_NAME) p2pEnv.P2P_TEST_HOST_PEER_NAME = process.env.P2P_TEST_HOST_PEER_NAME;
if (process.env.P2P_TEST_RELAY) p2pEnv.P2P_TEST_RELAY = process.env.P2P_TEST_RELAY;
if (process.env.P2P_TEST_APP_ID) p2pEnv.P2P_TEST_APP_ID = process.env.P2P_TEST_APP_ID;
if (process.env.P2P_TEST_HANDOFF_FILE) p2pEnv.P2P_TEST_HANDOFF_FILE = process.env.P2P_TEST_HANDOFF_FILE;
const env = Object.assign({}, defEnv, testEnv, p2pEnv);
const debuggerEnabled = env?.ENABLE_DEBUGGER === "true";
const enableUI = env?.ENABLE_UI === "true";
const headless = !debuggerEnabled && !enableUI;

export default mergeConfig(
    viteConfig,
    defineConfig({
        resolve: {
            alias: {
                obsidian: path.resolve(__dirname, "./test/harness/obsidian-mock.ts"),
            },
        },
        test: {
            env: env,
            testTimeout: 240000,
            hookTimeout: 240000,
            fileParallelism: false,
            isolate: true,
            watch: false,
            // Run all CLI-host P2P test files (*.p2p.test.ts, *.p2p-up.test.ts, *.p2p-down.test.ts)
            include: ["test/suitep2p/**/*.p2p*.test.ts"],
            browser: {
                isolate: true,
                // Only grantClipboardPermissions is needed; no openWebPeer/acceptWebPeer
                commands: {
                    grantClipboardPermissions,
                    writeHandoffFile,
                    readHandoffFile,
                },
                provider: playwright({
                    launchOptions: {
                        args: [
                            "--js-flags=--expose-gc",
                            "--allow-insecure-localhost",
                            "--disable-web-security",
                            "--ignore-certificate-errors",
                        ],
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
                        inspector: debuggerEnabled ? { waitForDebugger: true, enabled: true } : undefined,
                        printConsoleTrace: true,
                        onUnhandledError(error) {
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
