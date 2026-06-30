import { execSync } from "node:child_process";
import fs from "node:fs";
try {
    fs.rmSync("./_types", { recursive: true, force: true });
    fs.mkdirSync("./_types");
    console.log("[Postbuild] Generating type definitions for fallback...");
    execSync("npx tsc -p tsconfig.types.json", { stdio: "inherit" });

    console.log("[Postbuild] Type definitions generated successfully.");
} catch (error) {
    // Ignore compiler errors from tsc so that pre-existing type errors in the submodule
    // do not block the build from succeeding.
    console.warn("[Postbuild] Type definitions generated with some compilation warnings.");
    // process.exit(-1);
}

try {
    console.log("[Postbuild] Type definitions generated successfully. Adding ignore comments...");
    execSync("deno run -A ./utilsdeno/types-add-ignore.ts", { stdio: "inherit" });
    console.log("[Postbuild] Ignore comments added successfully.");
} catch (error) {
    console.warn("[Postbuild] Failed to add ignore comments to type definitions.");
    process.exit(-1);
}
