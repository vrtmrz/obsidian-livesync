import { LIVESYNC_COMMONLIB_VERSION } from "./livesync-commonlib-version.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("standalone utilities select one exact Commonlib registry version", async () => {
  const facadeURLs = [
    new URL("./setup/livesync-commonlib.ts", import.meta.url),
    new URL("./couchdb/livesync-commonlib.ts", import.meta.url),
  ];
  const selectedVersions = (
    await Promise.all(facadeURLs.map((url) => Deno.readTextFile(url)))
  ).flatMap((source) =>
    [...source.matchAll(
      /npm:@vrtmrz\/livesync-commonlib@([^/"]+)\//gu,
    )].map((match) => match[1])
  );

  assert(selectedVersions.length > 0, "no Commonlib npm specifier was found");
  assert(
    selectedVersions.every((version) => version === LIVESYNC_COMMONLIB_VERSION),
    `Commonlib specifiers do not all select ${LIVESYNC_COMMONLIB_VERSION}: ${
      selectedVersions.join(", ")
    }`,
  );
});
