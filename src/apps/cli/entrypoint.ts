#!/usr/bin/env node
import * as polyfill from "werift";
import { main } from "./main";

const rtcPolyfillCtor = (polyfill as any).RTCPeerConnection;
if (typeof (globalThis as any).RTCPeerConnection === "undefined" && typeof rtcPolyfillCtor === "function") {
    // Fill only the standard WebRTC global in Node CLI runtime.
    (globalThis as any).RTCPeerConnection = rtcPolyfillCtor;
}

main().catch((error) => {
    console.error(`[Fatal Error]`, error);
    process.exit(1);
});
