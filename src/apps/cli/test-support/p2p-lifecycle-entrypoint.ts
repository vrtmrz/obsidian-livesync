#!/usr/bin/env node
import { RTCPeerConnection } from "werift";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { createNodeStandardIo } from "@vrtmrz/livesync-commonlib/node";
import { writeStderrLine } from "@/apps/cli/cliOutput";
import { main, type CliCommandRunner } from "@/apps/cli/main";
import { parseTimeoutSeconds } from "@/apps/cli/commands/p2p";
import { runP2PReplicatorReplacementProbe } from "./p2p-replicator-replacement";

if (
    typeof (compatGlobal as unknown as Record<string, unknown>).RTCPeerConnection === "undefined" &&
    typeof RTCPeerConnection === "function"
) {
    (compatGlobal as unknown as Record<string, unknown>).RTCPeerConnection = RTCPeerConnection;
}

const standardIo = createNodeStandardIo();
const runLifecycleProbe: CliCommandRunner = async (options, context) => {
    if (options.command !== "p2p-sync" || options.commandArgs.length < 2) {
        throw new Error("The P2P lifecycle test entry requires: p2p-sync <peer> <timeout> [note-path] [note-content]");
    }
    const peerToken = options.commandArgs[0].trim();
    if (!peerToken) {
        throw new Error("The P2P lifecycle test entry requires a non-empty peer");
    }
    const timeoutSec = parseTimeoutSeconds(options.commandArgs[1], "P2P lifecycle test entry");
    return await runP2PReplicatorReplacementProbe(
        context,
        peerToken,
        timeoutSec * 1000,
        options.commandArgs[2],
        options.commandArgs[3]
    );
};

main(standardIo, runLifecycleProbe).catch((error) => {
    writeStderrLine(standardIo, "[Fatal Error]", error);
    process.exit(1);
});
