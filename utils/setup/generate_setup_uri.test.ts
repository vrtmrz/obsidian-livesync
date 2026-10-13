import {
  decodeSettingsFromSetupURI,
  DEFAULT_SETTINGS,
} from "./livesync-commonlib.ts";
import { generateSetupURI } from "./generate_setup_uri.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
    effective.customChunkSize === 10,
    "the journal chunk-size preset was not applied",
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
    "the P2P profile inherited the self-hosted CouchDB chunk-size recommendation",
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
