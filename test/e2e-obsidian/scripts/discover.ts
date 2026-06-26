import { discoverObsidianBinary } from "../runner/environment.ts";

const result = discoverObsidianBinary();
if (result.binary) {
    console.log(`Obsidian executable: ${result.binary}`);
    console.log(`Source: ${result.source}`);
    process.exit(0);
}

console.error("Obsidian executable was not found.");
console.error("Set OBSIDIAN_BINARY to the installed Obsidian executable path.");
console.error(`Checked paths: ${result.checked.length > 0 ? result.checked.join(", ") : "(none)"}`);
process.exit(1);
