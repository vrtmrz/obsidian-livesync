import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const cliDir = process.cwd();
const repoRoot = path.resolve(cliDir, "../../..");
const requiredFiles = [
    path.join(repoRoot, "src/lib/src/common/types.ts"),
];

const missingFiles = requiredFiles.filter((filePath) => !fs.existsSync(filePath));

if (missingFiles.length === 0) {
    process.exit(0);
}

console.error("[CLI Build Error] Required shared sources were not found.");
console.error("This repository uses Git submodules, and the CLI depends on src/lib.");
console.error("");
console.error("Missing file(s):");
for (const filePath of missingFiles) {
    console.error(`  - ${path.relative(repoRoot, filePath)}`);
}
console.error("");
console.error("Initialize submodules, then retry the CLI build:");
console.error("  git submodule update --init --recursive");
console.error("");
console.error("For a fresh clone, prefer:");
console.error("  git clone --recurse-submodules <repository-url>");
console.error("");
console.error("Then run:");
console.error("  npm install");
console.error("  cd src/apps/cli");
console.error("  npm run build");

process.exit(1);
