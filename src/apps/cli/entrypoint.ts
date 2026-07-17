#!/usr/bin/env node
import { RTCPeerConnection } from "werift";
import { main } from "./main";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";

if (
    typeof (compatGlobal as unknown as Record<string, unknown>).RTCPeerConnection === "undefined" &&
    typeof RTCPeerConnection === "function"
) {
    // Fill only the standard WebRTC global in Node CLI runtime.
    (compatGlobal as unknown as Record<string, unknown>).RTCPeerConnection = RTCPeerConnection;
}

main().catch((error) => {
    console.error(`[Fatal Error]`, error);
    process.exit(1);
});
