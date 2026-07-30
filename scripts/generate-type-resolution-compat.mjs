import { createRequire } from "node:module";
import {
    copyFile,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    realpath,
    rename,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMMONLIB_PACKAGE_NAME = "@vrtmrz/livesync-commonlib";
const PACKAGE_DEFINITIONS = [
    {
        name: COMMONLIB_PACKAGE_NAME,
        versionSource: "exact-dependency",
    },
    {
        name: "octagonal-wheels",
        versionSource: "lockfile",
    },
];
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT_ROOT = path.join(PROJECT_ROOT, "dist", "type-resolution-compat");
const DECLARATION_PATTERN = /\.d\.(?:c|m)?ts$/u;
const DECLARATION_MAP_PATTERN = /\.d\.(?:c|m)?ts\.map$/u;
const DIRECT_DEFAULT_EXPORT_PATTERN = /\bexport\s+(?:default\b|=)/u;
const DEFAULT_NAMESPACE_EXPORT_PATTERN = /\bexport\s*\*\s*as\s+default\b/u;
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const EXPORT_CLAUSE_PATTERN = /\bexport\s*\{([^}]*)\}/gu;
const SUPPRESSION_PATTERN = /@ts-(?:expect-error|ignore|nocheck)|eslint-(?:disable|enable)/u;

function fail(message) {
    throw new Error(message);
}

function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function parseArguments(argv) {
    const options = {
        expectedVersion: undefined,
        outputRoot: DEFAULT_OUTPUT_ROOT,
        packageName: undefined,
        packageRoot: undefined,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const value = argv[index + 1];
        if (argument === "--expected-version") {
            if (value === undefined) fail("--expected-version requires a value");
            options.expectedVersion = value;
            index += 1;
        } else if (argument === "--output") {
            if (value === undefined) fail("--output requires a value");
            options.outputRoot = path.resolve(value);
            index += 1;
        } else if (argument === "--package-root") {
            if (value === undefined) fail("--package-root requires a value");
            options.packageRoot = path.resolve(value);
            index += 1;
        } else if (argument === "--package-name") {
            if (value === undefined) fail("--package-name requires a value");
            options.packageName = value;
            index += 1;
        } else {
            fail(`Unknown argument: ${argument}`);
        }
    }
    if (
        options.packageRoot === undefined &&
        (options.packageName !== undefined || options.expectedVersion !== undefined)
    ) {
        fail("--package-name and --expected-version require --package-root");
    }
    return options;
}

async function readJson(filePath, description) {
    let source;
    try {
        source = await readFile(filePath, "utf8");
    } catch (error) {
        fail(`Cannot read ${description} at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        return JSON.parse(source);
    } catch (error) {
        fail(`Cannot parse ${description} at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function isWithin(parentPath, candidatePath) {
    const relative = path.relative(parentPath, candidatePath);
    return (
        relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    );
}

function validatePackageRelativePath(value, description) {
    if (typeof value !== "string" || !value.startsWith("./") || value.includes("\\")) {
        fail(`${description} must be a package-relative path beginning with './': ${String(value)}`);
    }
    const relativePath = value.slice(2);
    if (relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
        fail(`${description} contains path traversal or an empty path segment: ${value}`);
    }
    const normalised = path.posix.normalize(relativePath);
    if (
        relativePath.length === 0 ||
        normalised === "." ||
        normalised === ".." ||
        normalised.startsWith("../") ||
        path.posix.isAbsolute(normalised)
    ) {
        fail(`${description} contains path traversal or an empty path: ${value}`);
    }
    return normalised;
}

function resolveInsidePackage(packageRoot, packageRelativePath, description) {
    const resolved = path.resolve(packageRoot, ...packageRelativePath.split("/"));
    if (!isWithin(packageRoot, resolved)) {
        fail(`${description} escapes the package root: ${packageRelativePath}`);
    }
    return resolved;
}

async function pathExists(filePath) {
    try {
        await lstat(filePath);
        return true;
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

async function canonicaliseProspectivePath(filePath) {
    let existingAncestor = filePath;
    const missingSegments = [];
    while (!(await pathExists(existingAncestor))) {
        const parent = path.dirname(existingAncestor);
        if (parent === existingAncestor) fail(`Cannot resolve output directory: ${filePath}`);
        missingSegments.unshift(path.basename(existingAncestor));
        existingAncestor = parent;
    }
    return path.resolve(await realpath(existingAncestor), ...missingSegments);
}

async function validateOutputRoot(outputRoot, packageRoots) {
    if (await pathExists(outputRoot)) {
        const outputStat = await lstat(outputRoot);
        if (outputStat.isSymbolicLink() || !outputStat.isDirectory()) {
            fail(`Output path must be a real directory when it already exists: ${outputRoot}`);
        }
    }
    const canonicalOutputRoot = await canonicaliseProspectivePath(outputRoot);
    const canonicalProjectRoot = await realpath(PROJECT_ROOT);
    const canonicalPackageRoots = await Promise.all(
        packageRoots.map(async (packageRoot) => await realpath(packageRoot))
    );
    const filesystemRoot = path.parse(canonicalOutputRoot).root;
    const conflictsWithPackage = canonicalPackageRoots.some(
        (packageRoot) =>
            canonicalOutputRoot === packageRoot ||
            isWithin(canonicalOutputRoot, packageRoot) ||
            isWithin(packageRoot, canonicalOutputRoot)
    );
    if (
        canonicalOutputRoot === filesystemRoot ||
        canonicalOutputRoot === canonicalProjectRoot ||
        isWithin(canonicalOutputRoot, canonicalProjectRoot) ||
        conflictsWithPackage
    ) {
        fail(`Refusing unsafe output directory: ${outputRoot}`);
    }
}

function findInstalledPackageRoot(packageName) {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve(`${packageName}/package.json`, { paths: [PROJECT_ROOT] });
    return path.dirname(packageJsonPath);
}

async function determineExpectedVersion(packageName, versionSource, argumentVersion) {
    if (argumentVersion !== undefined) return argumentVersion;
    const projectPackage = await readJson(path.join(PROJECT_ROOT, "package.json"), "project package.json");
    const dependencyVersion = projectPackage.dependencies?.[packageName];
    if (typeof dependencyVersion !== "string") {
        fail(`${packageName} must be selected in project dependencies`);
    }
    if (versionSource === "exact-dependency") {
        if (!EXACT_VERSION_PATTERN.test(dependencyVersion)) {
            fail(`${packageName} must be selected by one exact version in project dependencies`);
        }
        return dependencyVersion;
    }
    if (versionSource !== "lockfile") {
        fail(`Unsupported version source for ${packageName}: ${String(versionSource)}`);
    }
    const packageLock = await readJson(path.join(PROJECT_ROOT, "package-lock.json"), "project package-lock.json");
    const lockVersion = packageLock.packages?.[`node_modules/${packageName}`]?.version;
    if (typeof lockVersion !== "string" || !EXACT_VERSION_PATTERN.test(lockVersion)) {
        fail(`${packageName} must have one exact installed version in project package-lock.json`);
    }
    return lockVersion;
}

async function resolvePackageInputs(options) {
    if (options.packageRoot !== undefined) {
        const packageName = options.packageName ?? COMMONLIB_PACKAGE_NAME;
        const definition = PACKAGE_DEFINITIONS.find((candidate) => candidate.name === packageName);
        if (definition === undefined) fail(`Unsupported package name: ${packageName}`);
        return [
            {
                expectedVersion: await determineExpectedVersion(
                    packageName,
                    definition.versionSource,
                    options.expectedVersion
                ),
                packageName,
                packageRoot: options.packageRoot,
            },
        ];
    }
    return await Promise.all(
        PACKAGE_DEFINITIONS.map(async (definition) => ({
            expectedVersion: await determineExpectedVersion(definition.name, definition.versionSource, undefined),
            packageName: definition.name,
            packageRoot: findInstalledPackageRoot(definition.name),
        }))
    );
}

function declarationRuntimeSpecifier(declarationPath) {
    if (declarationPath.endsWith(".d.ts")) return `${declarationPath.slice(0, -5)}.js`;
    if (declarationPath.endsWith(".d.mts")) return `${declarationPath.slice(0, -6)}.mjs`;
    if (declarationPath.endsWith(".d.cts")) return `${declarationPath.slice(0, -6)}.cjs`;
    fail(`Unsupported declaration extension: ${declarationPath}`);
}

function publicWrapperPath(exportSubpath) {
    if (exportSubpath === ".") return "index.d.ts";
    const relativeSubpath = validatePackageRelativePath(exportSubpath, `export subpath '${exportSubpath}'`);
    if (relativeSubpath === "package.json") return undefined;
    if (relativeSubpath === "__package__" || relativeSubpath.startsWith("__package__/")) {
        fail(`Export subpath uses the reserved internal directory: ${exportSubpath}`);
    }
    return `${relativeSubpath}.d.ts`;
}

async function collectDeclarationFiles(packageRoot) {
    const files = [];
    async function walk(relativeDirectory) {
        const absoluteDirectory = resolveInsidePackage(packageRoot, relativeDirectory || ".", "declaration directory");
        const entries = await readdir(absoluteDirectory, { withFileTypes: true });
        entries.sort((left, right) => compareText(left.name, right.name));
        for (const entry of entries) {
            const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
            if (entry.isSymbolicLink()) {
                fail(`Declaration tree contains a symbolic link: ${relativePath}`);
            }
            if (entry.isDirectory()) {
                if (relativePath !== "node_modules") await walk(relativePath);
            } else if (
                entry.isFile() &&
                (DECLARATION_PATTERN.test(relativePath) || DECLARATION_MAP_PATTERN.test(relativePath))
            ) {
                files.push(relativePath);
            }
        }
    }
    await walk("");
    return files;
}

function hasDefaultExport(source) {
    if (DIRECT_DEFAULT_EXPORT_PATTERN.test(source) || DEFAULT_NAMESPACE_EXPORT_PATTERN.test(source)) return true;
    for (const match of source.matchAll(EXPORT_CLAUSE_PATTERN)) {
        for (const rawSpecifier of match[1].split(",")) {
            const specifier = rawSpecifier.trim().replace(/^type\s+/u, "");
            if (
                specifier === "default" ||
                specifier === '"default"' ||
                specifier === "'default'" ||
                /\bas\s+(?:default|"default"|'default')$/u.test(specifier)
            ) {
                return true;
            }
        }
    }
    return false;
}

async function validateWrapperExports(packageRoot, typedExports) {
    const checkedTargets = new Set();
    for (const { exportSubpath, typesTarget } of typedExports) {
        if (checkedTargets.has(typesTarget)) continue;
        checkedTargets.add(typesTarget);
        const targetPath = resolveInsidePackage(packageRoot, typesTarget, `types target for export '${exportSubpath}'`);
        const source = await readFile(targetPath, "utf8");
        if (hasDefaultExport(source)) {
            fail(`Types target for export '${exportSubpath}' contains an unsupported default export: ${typesTarget}`);
        }
    }
}

async function validateAndCollectExports(packageName, packageRoot, packageJson) {
    if (packageJson.name !== packageName) {
        fail(`Expected package name ${packageName}, received ${String(packageJson.name)}`);
    }
    if (packageJson.exports === null || typeof packageJson.exports !== "object" || Array.isArray(packageJson.exports)) {
        fail("Package exports must be an object");
    }

    const destinations = new Map();
    const typedExports = [];
    let metadataExportCount = 0;
    const entries = Object.entries(packageJson.exports).sort(([left], [right]) => compareText(left, right));
    for (const [exportSubpath, exportDefinition] of entries) {
        const wrapperPath = publicWrapperPath(exportSubpath);
        if (wrapperPath === undefined) {
            if (exportSubpath !== "./package.json" || exportDefinition !== "./package.json") {
                fail(`Unsupported untyped package export: ${exportSubpath}`);
            }
            const metadataPath = resolveInsidePackage(packageRoot, "package.json", "package metadata export");
            const metadataStat = await stat(metadataPath);
            if (!metadataStat.isFile()) fail("Package metadata export does not point to a file");
            metadataExportCount += 1;
            continue;
        }
        if (
            exportDefinition === null ||
            typeof exportDefinition !== "object" ||
            Array.isArray(exportDefinition) ||
            typeof exportDefinition.types !== "string"
        ) {
            fail(`Export '${exportSubpath}' does not define one string types target`);
        }
        const typesTarget = validatePackageRelativePath(
            exportDefinition.types,
            `types target for export '${exportSubpath}'`
        );
        if (!DECLARATION_PATTERN.test(typesTarget)) {
            fail(`Types target for export '${exportSubpath}' is not a declaration file: ${exportDefinition.types}`);
        }
        const targetPath = resolveInsidePackage(packageRoot, typesTarget, `types target for export '${exportSubpath}'`);
        let targetStat;
        try {
            targetStat = await stat(targetPath);
        } catch (error) {
            fail(
                `Types target for export '${exportSubpath}' does not exist: ${typesTarget} (${
                    error instanceof Error ? error.message : String(error)
                })`
            );
        }
        if (!targetStat.isFile()) fail(`Types target for export '${exportSubpath}' is not a file: ${typesTarget}`);
        const destinationKey = wrapperPath.toLowerCase();
        const existingDestination = destinations.get(destinationKey);
        if (existingDestination !== undefined) {
            fail(
                `Exports '${existingDestination.exportSubpath}' and '${exportSubpath}' map to the same wrapper: ` +
                    `${existingDestination.wrapperPath} / ${wrapperPath}`
            );
        }
        destinations.set(destinationKey, { exportSubpath, wrapperPath });
        typedExports.push({ exportSubpath, typesTarget, wrapperPath });
    }
    if (metadataExportCount > 1) fail("Package contains duplicate metadata exports");
    return { exportCount: entries.length, metadataExportCount, typedExports };
}

async function copyDeclarationTree(packageRoot, internalRoot, declarationFiles) {
    await mkdir(internalRoot, { recursive: true });
    await copyFile(path.join(packageRoot, "package.json"), path.join(internalRoot, "package.json"));
    for (const relativePath of declarationFiles) {
        const sourcePath = resolveInsidePackage(packageRoot, relativePath, "declaration source");
        if (DECLARATION_PATTERN.test(relativePath)) {
            const source = await readFile(sourcePath, "utf8");
            if (SUPPRESSION_PATTERN.test(source)) {
                fail(`Declaration contains a suppression directive: ${relativePath}`);
            }
        }
        const destinationPath = resolveInsidePackage(internalRoot, relativePath, "declaration destination");
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await copyFile(sourcePath, destinationPath);
    }
}

async function writeWrappers(publicPackageRoot, typedExports) {
    for (const { typesTarget, wrapperPath } of typedExports) {
        const absoluteWrapperPath = resolveInsidePackage(publicPackageRoot, wrapperPath, "wrapper destination");
        const internalDeclaration = path.posix.join("__package__", typesTarget);
        let relativeTarget = path.posix.relative(path.posix.dirname(wrapperPath), internalDeclaration);
        relativeTarget = declarationRuntimeSpecifier(relativeTarget);
        if (!relativeTarget.startsWith(".")) relativeTarget = `./${relativeTarget}`;
        await mkdir(path.dirname(absoluteWrapperPath), { recursive: true });
        await writeFile(absoluteWrapperPath, `export * from ${JSON.stringify(relativeTarget)};\n`, "utf8");
    }
}

async function nextBackupPath(outputRoot) {
    for (let suffix = 0; suffix < 100; suffix += 1) {
        const candidate = `${outputRoot}.backup-${process.pid}-${suffix}`;
        if (!(await pathExists(candidate))) return candidate;
    }
    fail(`Cannot reserve a backup path for ${outputRoot}`);
}

async function replaceOutputDirectory(temporaryRoot, outputRoot) {
    let backupRoot;
    if (await pathExists(outputRoot)) {
        backupRoot = await nextBackupPath(outputRoot);
        await rename(outputRoot, backupRoot);
    }
    try {
        await rename(temporaryRoot, outputRoot);
    } catch (error) {
        if (backupRoot !== undefined) await rename(backupRoot, outputRoot);
        throw error;
    }
    if (backupRoot !== undefined) await rm(backupRoot, { recursive: true });
}

async function preparePackage({ expectedVersion, packageName, packageRoot }) {
    const packageJson = await readJson(path.join(packageRoot, "package.json"), `${packageName} package.json`);
    if (packageJson.version !== expectedVersion) {
        fail(`Expected ${packageName}@${expectedVersion}, received ${String(packageJson.version)}`);
    }
    const { exportCount, metadataExportCount, typedExports } = await validateAndCollectExports(
        packageName,
        packageRoot,
        packageJson
    );
    const declarationFiles = await collectDeclarationFiles(packageRoot);
    const declarationSet = new Set(declarationFiles);
    for (const { exportSubpath, typesTarget } of typedExports) {
        if (!declarationSet.has(typesTarget)) {
            fail(`Types target for export '${exportSubpath}' is outside the copied declaration tree: ${typesTarget}`);
        }
    }
    await validateWrapperExports(packageRoot, typedExports);
    return {
        declarationFiles,
        exportCount,
        metadataExportCount,
        packageJson,
        packageName,
        packageRoot,
        typedExports,
    };
}

async function writePreparedPackage(temporaryRoot, preparedPackage) {
    const { declarationFiles, packageName, packageRoot, typedExports } = preparedPackage;
    const publicPackageRoot = path.join(temporaryRoot, ...packageName.split("/"));
    const internalRoot = path.join(publicPackageRoot, "__package__");
    await copyDeclarationTree(packageRoot, internalRoot, declarationFiles);
    await writeWrappers(publicPackageRoot, typedExports);
}

function packageSummary(preparedPackage) {
    const { declarationFiles, exportCount, metadataExportCount, packageJson, packageName, typedExports } =
        preparedPackage;
    return {
        declarationCount: declarationFiles.filter((filePath) => DECLARATION_PATTERN.test(filePath)).length,
        exportCount,
        metadataExportCount,
        packageName,
        packageVersion: packageJson.version,
        typedExportCount: typedExports.length,
    };
}

async function generate(options) {
    const packageInputs = await resolvePackageInputs(options);
    await validateOutputRoot(
        options.outputRoot,
        packageInputs.map(({ packageRoot }) => packageRoot)
    );
    const preparedPackages = [];
    for (const packageInput of packageInputs) {
        preparedPackages.push(await preparePackage(packageInput));
    }
    const outputParent = path.dirname(options.outputRoot);
    await mkdir(outputParent, { recursive: true });
    const temporaryRoot = await mkdtemp(path.join(outputParent, `.${path.basename(options.outputRoot)}.tmp-`));
    try {
        for (const preparedPackage of preparedPackages) {
            await writePreparedPackage(temporaryRoot, preparedPackage);
        }
        await replaceOutputDirectory(temporaryRoot, options.outputRoot);
    } catch (error) {
        if (await pathExists(temporaryRoot)) await rm(temporaryRoot, { recursive: true });
        throw error;
    }

    return {
        outputDirectory: options.outputRoot,
        packages: preparedPackages.map(packageSummary),
    };
}

try {
    const result = await generate(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
}
