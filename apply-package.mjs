// Copy package.json dependencies and devDependencies from the repo root to the target sub-apps package.json, and set their versions to match the repo root version with a suffix.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = __dirname;
const repoPackageJsonPath = path.join(repoRoot, "package.json");
const repoPackageJson = JSON.parse(fs.readFileSync(repoPackageJsonPath, "utf-8"));
const devDependenciesToCopy = repoPackageJson.devDependencies || {};
const dependenciesToCopy = repoPackageJson.dependencies || {};

const TARGET_APPS = ["cli", "webapp", "webpeer"];

for (const app of TARGET_APPS) {
    const appDir = path.join(repoRoot, "src", "apps", app);
    const packageJsonPath = path.join(appDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
        continue;
    }
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

    packageJson.dependencies = {
        ...packageJson.dependencies,
        ...dependenciesToCopy,
    };
    packageJson.devDependencies = {
        ...packageJson.devDependencies,
        ...devDependenciesToCopy,
    };
    packageJson.version = `${repoPackageJson.version}-${app}`;

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 4), "utf-8");
    console.log(`Applied package.json dependencies and version from repo root to ${app} package.json`);
}

console.log("\nApplied dependencies and version to all target applications.");
console.log(
    "Please do not forget to pick dependencies that are actually needed in the target package.json, and remove the ones that are not needed."
);
