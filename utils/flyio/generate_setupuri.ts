import { runSetupURIGenerator } from "../setup/generate_setup_uri.ts";

await runSetupURIGenerator({
  ...Deno.env.toObject(),
  remote_type: "couchdb",
});
