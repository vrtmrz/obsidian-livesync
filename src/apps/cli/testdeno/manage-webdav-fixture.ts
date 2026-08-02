import { startWebDAV, stopWebDAV } from "./helpers/docker.ts";

const action = Deno.args[0];
const endpoint = (
    Deno.env.get("WEBDAV_ENDPOINT") ??
    Deno.env.get("webdavEndpoint") ??
    "http://127.0.0.1:8088/dav"
).replace(/\/+$/u, "");

try {
    if (action === "start") {
        await startWebDAV(endpoint);
    } else if (action === "stop") {
        await stopWebDAV();
    } else {
        throw new Error("Usage: manage-webdav-fixture.ts <start|stop>");
    }
} catch (error) {
    if (action === "start") await stopWebDAV().catch(() => undefined);
    console.error(error instanceof Error ? error.stack : error);
    Deno.exit(1);
}

// The shared Docker helper installs signal cleanup listeners for long-running
// Deno tests. This one-shot fixture command intentionally leaves the container
// running after 'start'; the matching 'stop' command owns its removal.
Deno.exit(0);
