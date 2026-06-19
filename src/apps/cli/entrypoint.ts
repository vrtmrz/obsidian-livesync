#!/usr/bin/env node
// eslint-disable -- This is the entry point for the CLI application.
import * as polyfill from "werift";
import { main } from "./main";
import { compatGlobal } from "@lib/common/coreEnvFunctions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Polyfill
const rtcPolyfillCtor = (polyfill as any).RTCPeerConnection;
if (
    typeof (compatGlobal as unknown as Record<string, unknown>).RTCPeerConnection === "undefined" &&
    typeof rtcPolyfillCtor === "function"
) {
    // Fill only the standard WebRTC global in Node CLI runtime.
    (compatGlobal as unknown as Record<string, unknown>).RTCPeerConnection = rtcPolyfillCtor;
}

main().catch((error) => {
    console.error(`[Fatal Error]`, error);
    process.exit(1);
});
