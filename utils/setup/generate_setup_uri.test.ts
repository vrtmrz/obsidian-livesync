import { decodeSettingsFromSetupURI } from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/compat/API/processSetting";
import { DEFAULT_SETTINGS } from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/settings";
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
  const decoded = await decodeSettingsFromSetupURI(
    generated.setupURI,
    generated.setupPassphrase,
  );
  assert(decoded, "Commonlib could not decode the Object Storage Setup URI");
  const effective = { ...DEFAULT_SETTINGS, ...decoded };
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
