import * as fs from "fs/promises";
import * as path from "path";

import micromatch from "micromatch";

/**
 * Loads and evaluates ignore rules from `.livesync/ignore` inside the vault.
 *
 * File format:
 *   - Lines starting with `#` are comments.
 *   - Blank lines are ignored.
 *   - `import: .gitignore` (exactly) — merges patterns from the vault's `.gitignore`.
 *   - All other lines are micromatch glob patterns relative to the vault root.
 *
 * Missing files (`.livesync/ignore` or `.gitignore`) are silently skipped.
 */
export class IgnoreRules {
    private patterns: string[] = [];

    constructor(private vaultPath: string) {}

    /**
     * Reads `.livesync/ignore` (and optionally `.gitignore`) and populates the
     * pattern list.  Safe to call multiple times — each call replaces the
     * previous state.  Does not throw if files are absent.
     */
    async load(): Promise<void> {
        this.patterns = [];
        const ignorePath = path.join(this.vaultPath, ".livesync", "ignore");
        let rawLines: string[];
        try {
            const content = await fs.readFile(ignorePath, "utf-8");
            rawLines = content.split(/\r?\n/);
        } catch {
            // File absent or unreadable — treat as empty ruleset.
            return;
        }

        for (const line of rawLines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) {
                continue;
            }
            // NOTE: Only the exact string "import: .gitignore" is recognised.
            // Any future generalisation of this directive must validate that
            // the resolved path stays within the vault directory.
            if (trimmed === "import: .gitignore") {
                await this._importGitignore();
                continue;
            }
            this._addPattern(trimmed);
        }
        if (this.patterns.length > 0) {
            console.error(`[IgnoreRules] Loaded ${this.patterns.length} ignore patterns`);
        }
    }

    // Normalises a single gitignore-style pattern:
    //   - Patterns ending with `/` (directory patterns like `build/`) are
    //     converted to `build/**` so they match all files inside that directory.
    //   - Patterns without a `/` are prefixed with `**/` to give them matchBase
    //     semantics (e.g. `*.tmp` → `**/*.tmp`), matching the basename in any
    //     subdirectory as gitignore does.
    //   - Patterns that already contain a `/` (but don't end with one) are
    //     path-specific and used as-is.
    private _normalisePattern(pattern: string): string {
        if (pattern.endsWith("/")) {
            return "**/" + pattern + "**";
        } else if (!pattern.includes("/")) {
            return "**/" + pattern;
        }
        return pattern;
    }

    private async _importGitignore(): Promise<void> {
        const gitignorePath = path.join(this.vaultPath, ".gitignore");
        let content: string;
        try {
            content = await fs.readFile(gitignorePath, "utf-8");
        } catch {
            return;
        }
        this._parseLines(content);
    }

    private _parseLines(content: string): void {
        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            this._addPattern(trimmed);
        }
    }

    private _addPattern(raw: string): void {
        if (raw.startsWith("!")) {
            console.error(`[IgnoreRules] Warning: negation pattern '${raw}' is not fully supported and will be ignored`);
            return;
        }
        this.patterns.push(this._normalisePattern(raw));
    }

    /**
     * Returns `true` if the given vault-relative path matches any loaded
     * ignore pattern.
     *
     * @param relativePath - Path relative to the vault root, using forward
     *   slashes or the OS separator.
     */
    shouldIgnore(relativePath: string): boolean {
        if (this.patterns.length === 0) {
            return false;
        }
        // Normalise to forward slashes for micromatch.
        const normalised = relativePath.replace(/\\/g, "/");
        return micromatch.isMatch(normalised, this.patterns, { dot: true });
    }

    /**
     * Returns the loaded patterns as absolute glob strings suitable for
     * chokidar's `ignored` option.
     */
    asGlobs(): string[] {
        return this.patterns.map((p) => {
            // If the pattern already looks absolute, return it as-is.
            if (path.isAbsolute(p)) {
                return p;
            }
            return this.vaultPath + "/" + p;
        });
    }
}
