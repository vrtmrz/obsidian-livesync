import { readFileSync, writeFileSync, statSync, readdirSync } from 'fs';
import { join, basename, resolve } from 'path';

// Read the root package.json file.
const rootPackagePath = resolve('package.json');
let rootPackage;
try {
    rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
} catch (error) {
    console.error('Failed to read the root package.json:', error);
    process.exit(1);
}

const mainVersion = rootPackage.version;
if (!mainVersion) {
    console.error('No version found in the root package.json.');
    process.exit(1);
}

const workspaces = rootPackage.workspaces;
if (!workspaces || !Array.isArray(workspaces)) {
    console.error('No workspaces array defined in the root package.json.');
    process.exit(1);
}

// Collect all root dependencies for version matching.
const rootDeps = {
    ...(rootPackage.dependencies || {}),
    ...(rootPackage.devDependencies || {}),
    ...(rootPackage.peerDependencies || {})
};

// Helper function to resolve glob patterns (for example, src/apps/*)
function resolveWorkspaceDirs(patterns) {
    const dirs = [];
    for (const pattern of patterns) {
        if (pattern.endsWith('/*')) {
            const baseDir = pattern.slice(0, -2);
            try {
                const subDirs = readdirSync(baseDir);
                for (const subDir of subDirs) {
                    const fullPath = join(baseDir, subDir);
                    if (statSync(fullPath).isDirectory()) {
                        dirs.push(fullPath);
                    }
                }
            } catch (error) {
                console.warn(`Could not read the directory for pattern '${pattern}':`, error.message);
            }
        } else {
            dirs.push(pattern);
        }
    }
    return dirs;
}

const workspaceDirs = resolveWorkspaceDirs(workspaces);

for (const dir of workspaceDirs) {
    const pkgJsonPath = join(dir, 'package.json');
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    } catch (error) {
        // Skip the directory if package.json does not exist.
        continue;
    }

    const workspaceName = basename(dir);
    const targetVersion = `${mainVersion}-${workspaceName}`;

    console.log(`Updating ${pkg.name || dir}:`);
    console.log(`  Version: ${pkg.version} -> ${targetVersion}`);
    pkg.version = targetVersion;

    // Synchronise dependencies.
    if (pkg.dependencies) {
        for (const dep of Object.keys(pkg.dependencies)) {
            if (dep in rootDeps) {
                const oldVer = pkg.dependencies[dep];
                const newVer = rootDeps[dep];
                if (oldVer !== newVer) {
                    console.log(`  Dependency '${dep}': ${oldVer} -> ${newVer}`);
                    pkg.dependencies[dep] = newVer;
                }
            }
        }
    }

    // Synchronise devDependencies.
    if (pkg.devDependencies) {
        for (const dep of Object.keys(pkg.devDependencies)) {
            if (dep in rootDeps) {
                const oldVer = pkg.devDependencies[dep];
                const newVer = rootDeps[dep];
                if (oldVer !== newVer) {
                    console.log(`  DevDependency '${dep}': ${oldVer} -> ${newVer}`);
                    pkg.devDependencies[dep] = newVer;
                }
            }
        }
    }

    // Write back the modified package.json file.
    try {
        writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 4) + '\n', 'utf8');
        console.log(`  Successfully updated ${pkgJsonPath}`);
    } catch (error) {
        console.error(`  Failed to write ${pkgJsonPath}:`, error);
    }
}
