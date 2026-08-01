import { startPostgREST, stopPostgREST } from "./helpers/docker.ts";

const action = Deno.args[0];
const endpoint = (
    Deno.env.get("POSTGREST_ENDPOINT") ??
    Deno.env.get("postgrestEndpoint") ??
    "http://127.0.0.1:3001"
).replace(/\/+$/u, "");

try {
    if (action === "start") {
        await startPostgREST(endpoint);
    } else if (action === "stop") {
        await stopPostgREST();
    } else {
        throw new Error("Usage: manage-postgrest-fixture.ts <start|stop>");
    }
} catch (error) {
    if (action === "start") await stopPostgREST().catch(() => undefined);
    console.error(error instanceof Error ? error.stack : error);
    Deno.exit(1);
}

// The one-shot command intentionally leaves successful services running after
// 'start'; the matching 'stop' command owns their removal.
Deno.exit(0);
