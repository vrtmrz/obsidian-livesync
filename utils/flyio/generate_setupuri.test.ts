import {
  decodeSettingsFromSetupURI,
  DEFAULT_SETTINGS,
} from "../setup/livesync-commonlib.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("generates a current self-hosted Setup URI through the published Commonlib contract", async () => {
  const scriptPath = new URL("./generate_setupuri.ts", import.meta.url);
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", scriptPath.pathname],
    env: {
      hostname: "https://couch.example.test",
      username: "alice",
      password: "couch-secret",
      database: "notes",
      passphrase: "vault-secret",
      uri_passphrase: "setup-secret",
    },
    stdout: "piped",
    stderr: "piped",
  });

  const result = await command.output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  assert(result.success, `generator failed:\n${stdout}\n${stderr}`);

  const setupURI = stdout.match(/obsidian:\/\/setuplivesync\?settings=\S+/)
    ?.[0];
  assert(setupURI, `generator did not print a Setup URI:\n${stdout}`);

  const decoded = await decodeSettingsFromSetupURI(setupURI, "setup-secret");
  assert(decoded, "Commonlib could not decode the generated Setup URI");
  const effectiveSettings = { ...DEFAULT_SETTINGS, ...decoded };
  assert(
    effectiveSettings.isConfigured,
    "the CouchDB Setup URI left the imported device unconfigured",
  );
  assert(
    effectiveSettings.customChunkSize === 60,
    "the Setup URI did not use the current self-hosted chunk-size recommendation",
  );
  assert(
    effectiveSettings.chunkSplitterVersion === "v3-rabin-karp",
    "the Setup URI did not use the current chunk splitter",
  );
  assert(
    effectiveSettings.E2EEAlgorithm === "v2",
    "the Setup URI did not use the current E2EE algorithm",
  );
  assert(
    !Object.hasOwn(decoded, "doNotUseFixedRevisionForChunks"),
    "the Setup URI serialised the obsolete fixed-revision compatibility setting",
  );

  const profiles = Object.values(decoded.remoteConfigurations ?? {});
  assert(
    profiles.length === 1,
    "the Setup URI did not contain exactly one CouchDB remote profile",
  );
  assert(
    decoded.activeConfigurationId === profiles[0].id,
    "the CouchDB remote profile was not selected",
  );
  assert(
    profiles[0].uri.startsWith("sls+https://"),
    "the selected remote profile was not a CouchDB connection URI",
  );
});
