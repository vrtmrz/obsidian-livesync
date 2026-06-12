// Copy package.json dependencies and devDependencies from the repo root to the cli package.json, and set the version to match the repo root version with a -cli suffix.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const cliDir = process.cwd();
const repoRoot = path.resolve(cliDir, "../../..");
const repoPackageJsonPath = path.join(repoRoot, "package.json");
const repoPackageJson = JSON.parse(fs.readFileSync(repoPackageJsonPath, "utf-8"));
const devDependenciesToCopy = repoPackageJson.devDependencies || {};
const dependenciesToCopy = repoPackageJson.dependencies || {};
const packageJsonPath = path.join(cliDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
packageJson.dependencies = {
    ...packageJson.dependencies,
    ...dependenciesToCopy,
};
packageJson.devDependencies = {
    ...packageJson.devDependencies,
    ...devDependenciesToCopy,
};
packageJson.version = `${repoPackageJson.version}-cli`;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 4), "utf-8");

console.log("Applied package.json dependencies and version from repo root to cli package.json");
console.log(
    "Please do not forget to pick dependencies that are actually needed in the cli package.json, and remove the ones that are not needed."
);
