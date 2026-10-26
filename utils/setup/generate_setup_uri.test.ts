import { fileURLToPath } from "node:url";
import {
  decodeSettingsFromSetupURI,
  DEFAULT_SETTINGS,
  PREFERRED_JOURNAL_SYNC,
} from "./livesync-commonlib.ts";
import { generateSetupURI } from "./generate_setup_uri.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("reads LIVESYNC_ variables before the unprefixed names", async () => {
  const generated = await generateSetupURI({
    LIVESYNC_HOST: "https://couch.example.test",
    LIVESYNC_USER: "alice",
    LIVESYNC_PASS: "couch-secret",
    LIVESYNC_DB: "notes",
    LIVESYNC_PASSPHRASE: "vault-secret",
    hostname: "https://shell.example.test",
    username: "shell-user",
    password: "shell-secret",
    database: "shell-db",
    passphrase: "shell-passphrase",
    uri_passphrase: "setup-secret",
  });
  const decoded = await decodeSettingsFromSetupURI(
    generated.setupURI,
    generated.setupPassphrase,
  );
  assert(decoded, "Commonlib could not decode the CouchDB Setup URI");
  const effective = { ...DEFAULT_SETTINGS, ...decoded };
  assert(
    effective.couchDB_URI === "https://couch.example.test" &&
      effective.couchDB_USER === "alice" &&
      effective.couchDB_PASSWORD === "couch-secret" &&
      effective.couchDB_DBNAME === "notes",
    "the CouchDB connection did not come from the LIVESYNC_ variables",
  );
  assert(
    effective.passphrase === "vault-secret",
    "the Vault passphrase did not come from LIVESYNC_PASSPHRASE",
  );
});

Deno.test("falls back to the unprefixed names when LIVESYNC_ variables are blank", async () => {
  const generated = await generateSetupURI({
    LIVESYNC_HOST: " ",
    hostname: "https://couch.example.test",
    username: "alice",
    password: "couch-secret",
    database: "notes",
    passphrase: "vault-secret",
    uri_passphrase: "setup-secret",
  });
  const decoded = await decodeSettingsFromSetupURI(
    generated.setupURI,
    generated.setupPassphrase,
  );
  assert(decoded, "Commonlib could not decode the CouchDB Setup URI");
  const effective = { ...DEFAULT_SETTINGS, ...decoded };
  assert(
    effective.couchDB_URI === "https://couch.example.test" &&
      effective.couchDB_USER === "alice" &&
      effective.couchDB_PASSWORD === "couch-secret" &&
      effective.couchDB_DBNAME === "notes" &&
      effective.passphrase === "vault-secret",
    "the generator did not fall back to the unprefixed names",
  );
});

Deno.test("names both variables when a CouchDB value is missing", async () => {
  let rejected = false;
  try {
    await generateSetupURI({ uri_passphrase: "setup-secret" });
  } catch (error) {
    rejected = error instanceof Error &&
      error.message === "LIVESYNC_HOST (or hostname) is required";
  }
  assert(rejected, "the generator did not name both host variables");
});

Deno.test("generates an Object Storage Setup URI with a selected S3 profile", async () => {
  const generated = await generateSetupURI({
    remote_type: "s3",
    endpoint: "https://objects.example.test",
    access_key: "access-key",
    secret_key: "secret-key",
    bucket: "vault-data",
    region: "auto",
    bucket_prefix: "team-a",
    passphrase: "vault-secret",
    uri_passphrase: "setup-secret",
  });
  assert(
    generated.mode === "ephemeral",
    "the default Setup URI mode was not Ephemeral",
  );
  assert(
    generated.usableUntil !== null && generated.usableUntil > Date.now(),
    "the Ephemeral Setup URI did not report its usable end time",
  );
  const decoded = await decodeSettingsFromSetupURI(
    generated.setupURI,
    generated.setupPassphrase,
  );
  assert(decoded, "Commonlib could not decode the Object Storage Setup URI");
  const effective = { ...DEFAULT_SETTINGS, ...decoded };
  const recoveryCode = generated.idRecoveryCode;
  assert(
    typeof recoveryCode === "string" && recoveryCode.startsWith("sls-id-v1:"),
    "the generator did not return an ID recovery code",
  );
  assert(
    (effective as typeof effective & { idDerivationVersion?: number })
      .idDerivationVersion === 1,
    "the Setup URI did not enable independent IDs",
  );
  assert(
    (effective as typeof effective & { idDerivationKey?: string })
      .idDerivationKey ===
      recoveryCode.slice("sls-id-v1:".length),
    "the Setup URI did not contain the generated ID key",
  );
  assert(
    effective.isConfigured,
    "the Setup URI left the imported device unconfigured",
  );
  assert(
    effective.customChunkSize === PREFERRED_JOURNAL_SYNC.customChunkSize,
    "the Object Storage Setup URI did not use its Commonlib journal chunk-size preference",
  );
  assert(
    effective.liveSync,
    "Object Storage was not configured for live journal synchronisation",
  );
  assert(
    effective.endpoint === "https://objects.example.test",
    "the endpoint was not preserved",
  );
  assert(
    effective.bucketPrefix === "team-a",
    "the bucket prefix was not preserved",
  );

  const profiles = Object.values(decoded.remoteConfigurations ?? {});
  assert(
    profiles.length === 1,
    "the Setup URI did not contain exactly one Object Storage profile",
  );
  assert(
    decoded.activeConfigurationId === profiles[0].id,
    "the Object Storage profile was not selected",
  );
  assert(
    profiles[0].uri.startsWith("sls+s3://"),
    "the selected profile was not an S3 connection URI",
  );
});

Deno.test("generates a random-room P2P Setup URI without copying a device identity", async () => {
  const generated = await generateSetupURI({
    remote_type: "p2p",
    passphrase: "vault-secret",
    uri_passphrase: "setup-secret",
  });
  const decoded = await decodeSettingsFromSetupURI(
    generated.setupURI,
    generated.setupPassphrase,
  );
  assert(decoded, "Commonlib could not decode the P2P Setup URI");
  const effective = { ...DEFAULT_SETTINGS, ...decoded };
  assert(
    (effective as typeof effective & { idDerivationKey?: string })
      .idDerivationKey ===
      generated.idRecoveryCode?.slice("sls-id-v1:".length),
    "the P2P Setup URI did not contain the generated ID key",
  );
  assert(
    /^\d{3}-\d{3}-\d{3}-[a-z0-9]{3}$/.test(effective.P2P_roomID),
    "Commonlib did not generate the expected random room ID",
  );
  assert(
    /^[A-Za-z0-9_-]{32}$/.test(effective.P2P_passphrase),
    "the generated P2P passphrase was not a 32-character base64url secret",
  );
  assert(
    !effective.P2P_AutoStart,
    "P2P auto-start was enabled without an explicit request",
  );
  assert(
    !effective.P2P_AutoBroadcast,
    "P2P auto-broadcast was enabled without an explicit request",
  );
  assert(
    effective.customChunkSize === 0,
    "the P2P Setup URI did not retain its zero chunk-size value",
  );
  assert(
    effective.sendChunksBulkMaxSize === 1,
    "the P2P profile did not retain the conservative manual resend size",
  );
  assert(
    !Object.hasOwn(decoded, "P2P_DevicePeerName"),
    "the Setup URI copied a device-specific P2P peer name",
  );

  const profiles = Object.values(decoded.remoteConfigurations ?? {});
  assert(
    profiles.length === 1,
    "the Setup URI did not contain exactly one P2P profile",
  );
  assert(
    decoded.activeConfigurationId === profiles[0].id,
    "the P2P profile was not selected as the main remote",
  );
  assert(
    decoded.P2P_ActiveRemoteConfigurationId === profiles[0].id,
    "the P2P profile was not selected for P2P features",
  );
  assert(
    profiles[0].uri.startsWith("sls+p2p://"),
    "the selected profile was not a P2P connection URI",
  );
});

Deno.test("generates a Persistent Setup URI on explicit request", async () => {
  const generated = await generateSetupURI({
    remote_type: "p2p",
    passphrase: "vault-secret",
    uri_passphrase: "setup-secret",
    uri_mode: "persistent",
  });
  assert(generated.mode === "persistent", "the explicit mode was not retained");
  assert(
    generated.usableUntil === null,
    "Persistent unexpectedly has a time condition",
  );
  const decoded = await decodeSettingsFromSetupURI(
    generated.setupURI,
    generated.setupPassphrase,
  );
  assert(decoded, "the Persistent Setup URI could not be opened");
});

Deno.test("rejects an unknown Setup URI mode", async () => {
  let rejected = false;
  try {
    await generateSetupURI({ uri_mode: "later" });
  } catch (error) {
    rejected = error instanceof Error &&
      error.message === "uri_mode must be ephemeral or persistent";
  }
  assert(rejected, "the generator accepted an unknown Setup URI mode");
});

for (const mode of ["ephemeral", "persistent"] as const) {
  Deno.test(`preserves ID recovery and explicit legacy IDs in ${mode} URIs`, async () => {
    const environment = {
      remote_type: "p2p",
      uri_mode: mode,
      passphrase: "vault-secret",
      uri_passphrase: "setup-secret",
    };
    const first = await generateSetupURI(environment);
    const second = await generateSetupURI({
      ...environment,
      id_recovery_code: first.idRecoveryCode,
    });
    const independentlyGenerated = await generateSetupURI(environment);
    assert(
      second.idRecoveryCode === first.idRecoveryCode,
      "the recovery code changed on repeat generation",
    );
    assert(
      independentlyGenerated.idRecoveryCode !== first.idRecoveryCode,
      "the default ID key was reused",
    );
    const repeatedSettings = await decodeSettingsFromSetupURI(
      second.setupURI,
      second.setupPassphrase,
    );
    assert(repeatedSettings, "the repeated Setup URI could not be decoded");
    assert(
      (repeatedSettings as typeof repeatedSettings & {
        idDerivationKey?: string;
      }).idDerivationKey ===
        first.idRecoveryCode?.slice("sls-id-v1:".length),
      "the recovery code did not restore the original ID key",
    );

    const legacy = await generateSetupURI({
      ...environment,
      id_mode: "legacy",
    });
    const decoded = await decodeSettingsFromSetupURI(
      legacy.setupURI,
      legacy.setupPassphrase,
    );
    assert(decoded, "the legacy Setup URI could not be decoded");
    assert(
      legacy.idRecoveryCode === undefined,
      "legacy mode returned an ID recovery code",
    );
    assert(
      (decoded as typeof decoded & { idDerivationVersion?: number })
        .idDerivationVersion !== 1,
      "legacy mode enabled independent IDs",
    );
    let rejected = false;
    try {
      await generateSetupURI({
        ...environment,
        id_recovery_code: "sls-id-v1:wrong",
      });
    } catch {
      rejected = true;
    }
    assert(rejected, "an invalid recovery code was accepted");
    rejected = false;
    try {
      await generateSetupURI({
        ...environment,
        id_mode: "legacy",
        id_recovery_code: first.idRecoveryCode,
      });
    } catch {
      rejected = true;
    }
    assert(rejected, "legacy mode silently ignored a recovery code");
  });
}

const couchDBConnection = {
  hostname: "https://couch.example.test",
  username: "alice",
  password: "couch-secret",
  database: "notes",
  passphrase: "vault-secret",
};
const prefixedCouchDBConnection = {
  LIVESYNC_HOST: couchDBConnection.hostname,
  LIVESYNC_USER: couchDBConnection.username,
  LIVESYNC_PASS: couchDBConnection.password,
  LIVESYNC_DB: couchDBConnection.database,
  LIVESYNC_PASSPHRASE: couchDBConnection.passphrase,
};
const commandEnvironments: { name: string; values: Record<string, string> }[] =
  [
    { name: "prefixed values only", values: prefixedCouchDBConnection },
    {
      name: "prefixed values before conflicting legacy values",
      values: {
        ...prefixedCouchDBConnection,
        hostname: "https://shell.example.test",
        username: "shell-user",
        password: "shell-password",
        database: "shell-database",
        passphrase: "shell-passphrase",
      },
    },
    {
      name: "blank prefixed values fall back to legacy values",
      values: {
        ...couchDBConnection,
        LIVESYNC_HOST: " ",
        LIVESYNC_USER: "\t",
        LIVESYNC_PASS: " ",
        LIVESYNC_DB: "\t",
        LIVESYNC_PASSPHRASE: " ",
      },
    },
    { name: "compatibility: legacy values only", values: couchDBConnection },
  ];

async function runGeneratorCommand(
  script: URL,
  values: Record<string, string>,
) {
  const environment = Deno.env.toObject();
  const inputNames = new Set([
    ...Object.keys(couchDBConnection),
    ...Object.keys(prefixedCouchDBConnection),
    "remote_type",
    "uri_passphrase",
    "uri_mode",
    "id_mode",
    "id_recovery_code",
    "endpoint",
    "access_key",
    "secret_key",
    "bucket",
    "region",
    "bucket_prefix",
    "bucket_custom_headers",
    "use_custom_request_handler",
    "force_path_style",
    "p2p_room_id",
    "p2p_passphrase",
    "p2p_relays",
    "p2p_app_id",
    "p2p_auto_start",
    "p2p_auto_broadcast",
  ].map((name) => name.toLowerCase()));
  for (const name of Object.keys(environment)) {
    if (inputNames.has(name.toLowerCase())) delete environment[name];
  }
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--config",
      fileURLToPath(new URL("../flyio/deno.jsonc", import.meta.url)),
      "--frozen",
      "--lock",
      fileURLToPath(new URL("../flyio/deno.lock", import.meta.url)),
      "--allow-env",
      script.href,
    ],
    clearEnv: true,
    env: {
      ...environment,
      uri_passphrase: "setup-secret",
      uri_mode: "persistent",
      ...values,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(
    result.success,
    `generator failed: ${new TextDecoder().decode(result.stderr)}`,
  );
  const output = new TextDecoder().decode(result.stdout);
  const uri = output.match(/obsidian:\/\/setuplivesync\?settings=\S+/u)?.[0];
  assert(uri, "the command did not print a Setup URI");
  const decoded = await decodeSettingsFromSetupURI(uri, "setup-secret");
  assert(decoded, "the command output could not be decoded");
  return { ...DEFAULT_SETTINGS, ...decoded };
}

for (
  const [name, path] of [
    ["Setup generator", "./generate_setup_uri.ts"],
    ["Fly.io wrapper", "../flyio/generate_setupuri.ts"],
  ]
) {
  for (const scenario of commandEnvironments) {
    Deno.test(`E2E ${name}: ${scenario.name}`, async () => {
      const settings = await runGeneratorCommand(
        new URL(path, import.meta.url),
        scenario.values,
      );
      assert(
        settings.couchDB_URI === couchDBConnection.hostname &&
          settings.couchDB_USER === couchDBConnection.username &&
          settings.couchDB_PASSWORD === couchDBConnection.password &&
          settings.couchDB_DBNAME === couchDBConnection.database &&
          settings.passphrase === couchDBConnection.passphrase,
        "the command did not preserve the selected connection and Vault passphrase",
      );
      const profileId = settings.activeConfigurationId;
      const profile = profileId
        ? settings.remoteConfigurations?.[profileId]
        : undefined;
      assert(
        profile?.uri.startsWith("sls+https://"),
        "the generated URI did not select its CouchDB profile",
      );
    });
  }
}

for (const remoteType of ["s3", "p2p"]) {
  Deno.test(`E2E Setup generator: prefixed Vault passphrase for ${remoteType}`, async () => {
    const settings = await runGeneratorCommand(
      new URL("./generate_setup_uri.ts", import.meta.url),
      {
        remote_type: remoteType,
        endpoint: "https://objects.example.test",
        access_key: "access-key",
        secret_key: "secret-key",
        bucket: "vault-data",
        LIVESYNC_PASSPHRASE: "vault-secret",
        passphrase: "shell-passphrase",
      },
    );
    assert(
      settings.passphrase === "vault-secret",
      "the command did not prefer LIVESYNC_PASSPHRASE",
    );
    const profileId = settings.activeConfigurationId;
    const profile = profileId
      ? settings.remoteConfigurations?.[profileId]
      : undefined;
    assert(
      profile?.uri.startsWith(`sls+${remoteType}://`),
      "the command did not select the requested remote profile",
    );
  });
}
