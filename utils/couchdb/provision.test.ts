import { provisionCouchDB } from "./provision.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("configures CouchDB and delegates database-version initialisation", async () => {
  const requests: Array<{ url: string; method: string; body: string }> = [];
  const initialisations: Array<[string, string, string]> = [];
  await provisionCouchDB(
    {
      hostname: "https://couch.example.test/",
      username: "alice",
      password: "secret",
      database: "notes",
      retryCount: 1,
      retryDelayMs: 0,
    },
    {
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: String(init?.body ?? ""),
        });
        return new Response("{}", { status: 201 });
      },
      sleep: async () => {},
      initialiseDatabaseVersion: async (...args) => {
        initialisations.push(args);
      },
    },
  );

  assert(
    requests[0].url.endsWith("/_cluster_setup"),
    "cluster setup was not first",
  );
  assert(
    requests.some((request) =>
      request.url.endsWith("/_config/cors/origins") &&
      request.body.includes("app://obsidian.md")
    ),
    "the Obsidian CORS origins were not configured",
  );
  assert(
    requests.at(-1)?.url === "https://couch.example.test/notes",
    "the requested database was not created last",
  );
  assert(
    initialisations.length === 1,
    "database-version initialisation was not delegated once",
  );
  assert(
    initialisations[0][0] === "https://couch.example.test/notes",
    "database-version initialisation used the wrong URL",
  );
});

Deno.test("leaves database creation to the client when no database is supplied", async () => {
  let initialised = false;
  await provisionCouchDB(
    {
      hostname: "http://127.0.0.1:5984",
      username: "admin",
      password: "secret",
      retryCount: 1,
      retryDelayMs: 0,
    },
    {
      fetch: async () => new Response("{}", { status: 200 }),
      sleep: async () => {},
      initialiseDatabaseVersion: async () => {
        initialised = true;
      },
    },
  );

  assert(
    !initialised,
    "database-version initialisation ran without a database",
  );
});
