#!/usr/bin/env node
import { RTCPeerConnection } from "werift";
import { main } from "./main.js";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions.js";
import { createNodeStandardIo } from "@vrtmrz/livesync-commonlib/node.js";
import { writeStderrLine } from "./cliOutput.js";

if (
    typeof (compatGlobal as unknown as Record<string, unknown>).RTCPeerConnection === "undefined" &&
    typeof RTCPeerConnection === "function"
) {
    // Fill only the standard WebRTC global in Node CLI runtime.
    (compatGlobal as unknown as Record<string, unknown>).RTCPeerConnection = RTCPeerConnection;
}

const standardIo = createNodeStandardIo();

main(standardIo).catch((error) => {
    writeStderrLine(standardIo, `[Fatal Error]`, error);
    process.exit(1);
});
