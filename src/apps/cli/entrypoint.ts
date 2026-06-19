#!/usr/bin/env node
// eslint-disable -- This is the entry point for the CLI application.
import * as polyfill from "werift";
import { main } from "./main";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Polyfill 
const rtcPolyfillCtor = (polyfill as any).RTCPeerConnection;
if (typeof (global as any).RTCPeerConnection === "undefined" && typeof rtcPolyfillCtor === "function") {
    // Fill only the standard WebRTC global in Node CLI runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Polyfill 
    (global as any).RTCPeerConnection = rtcPolyfillCtor;
}

main().catch((error) => {
    console.error(`[Fatal Error]`, error);
    process.exit(1);
});
