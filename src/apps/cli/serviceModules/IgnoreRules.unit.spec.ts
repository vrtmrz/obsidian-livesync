import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IgnoreRules } from "./IgnoreRules";

describe("IgnoreRules", () => {
    const tempDirs: string[] = [];

    async function createVault(): Promise<string> {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "livesync-ignorerules-"));
        tempDirs.push(tempDir);
        return tempDir;
    }

    async function writeIgnoreFile(vaultPath: string, content: string): Promise<void> {
        const ignoreDir = path.join(vaultPath, ".livesync");
        await fs.mkdir(ignoreDir, { recursive: true });
        await fs.writeFile(path.join(ignoreDir, "ignore"), content, "utf-8");
    }

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    });

    describe("pattern normalisation", () => {
        it("adds **/ prefix to basename patterns (no slash)", async () => {
            const vaultPath = await createVault();
            await writeIgnoreFile(vaultPath, "*.tmp\n");
            const rules = new IgnoreRules(vaultPath);
            await rules.load();
            expect(rules.shouldIgnore("notes/scratch.tmp")).toBe(true);
            expect(rules.shouldIgnore("scratch.tmp")).toBe(true);
            expect(rules.shouldIgnore("deep/nested/file.tmp")).toBe(true);
        });

        it("appends ** to directory patterns ending with / and prepends **/", async () => {
            const vaultPath = await createVault();
            await writeIgnoreFile(vaultPath, "build/\n");
            const rules = new IgnoreRules(vaultPath);
            await rules.load();
            expect(rules.shouldIgnore("build/output.js")).toBe(true);
            expect(rules.shouldIgnore("build/nested/file.js")).toBe(true);
            expect(rules.shouldIgnore("subproject/build/output.js")).toBe(true);
        });

        it("leaves patterns containing / as-is", async () => {
            const vaultPath = await createVault();
            await writeIgnoreFile(vaultPath, "docs/private.md\n");
            const rules = new IgnoreRules(vaultPath);
            await rules.load();
            expect(rules.shouldIgnore("docs/private.md")).toBe(true);
            expect(rules.shouldIgnore("other/docs/private.md")).toBe(false);
        });

        it("rejects negation patterns with a warning", async () => {
            const vaultPath = await createVault();
            await writeIgnoreFile(vaultPath, "*.tmp\n!important.tmp\n");
            const rules = new IgnoreRules(vaultPath);
            await rules.load();
            // Negation patterns are rejected at parse time — only *.tmp is kept
            expect(rules.shouldIgnore("other.tmp")).toBe(true);
            const globs = rules.asGlobs();
            expect(globs).toHaveLength(1);
        });
    });

    describe("shouldIgnore", () => {
        it("matches **/*.tmp against notes/scratch.tmp", async () => {
            const vaultPath = await createVault();
            await writeIgnoreFile(vaultPath, "*.tmp\n");
            const rules = new IgnoreRules(vaultPath);
            await rules.load();
            expect(rules.shouldIgnore("notes/scratch.tmp")).toBe(true);
        });

        it("does not match notes/readme.md against **/*.tmp", async () => {
            const vaultPath = await createVault();
            await writeIgnoreFile(vaultPath, "*.tmp\n");
            const rules = new IgnoreRules(vaultPath);
            await rules.load();
            expect(rules.shouldIgnore("notes/readme.md")).toBe(false);
        });

        it("returns false when no patterns are loaded", async () => {
            const vaultPath = await createVault();
            const rules = new IgnoreRules(vaultPath);
            // No load() call — patterns are empty
            expect(rules.shouldIgnore("anything.md")).toBe(false);
        });
    });

    describe("negation patterns", () => {
        it("rejects negation patterns at parse time", async () => {
            const vaultPath = await createVault();
            await writeIgnoreFile(vaultPath, "*.tmp\n!*.md\n");
            const rules = new IgnoreRules(vaultPath);
            await rules.load();
            // Only *.tmp should be loaded — negation pattern rejected
            const globs = rules.asGlobs();
            expect(globs).toHaveLength(1);
            expect(rules.shouldIgnore("notes/scratch.tmp")).toBe(true);
            expect(rules.shouldIgnore("notes/readme.md")).toBe(false);
        });
    });

    describe("asGlobs()", () => {
        it("prefixes patterns with vault path using / separator", async () => {
            const vaultPath = await createVault();
            await writeIgnoreFile(vaultPath, "*.tmp\n");
            const rules = new IgnoreRules(vaultPath);
            await rules.load();
            const globs = rules.asGlobs();
            expect(globs.length).toBe(1);
            expect(globs[0]).toBe(vaultPath + "/" + "**/*.tmp");
        });

        it("negation patterns are rejected, not included in globs", async () => {
            const vaultPath = await createVault();
            await writeIgnoreFile(vaultPath, "*.tmp\n!keep.tmp\nbuild/\n");
            const rules = new IgnoreRules(vaultPath);
            await rules.load();
            const globs = rules.asGlobs();
            // !keep.tmp rejected at parse time — only *.tmp and build/ remain
            expect(globs).toHaveLength(2);
            expect(globs[0]).toBe(vaultPath + "/" + "**/*.tmp");
            expect(globs[1]).toBe(vaultPath + "/" + "**/build/**");
        });
    });

    describe("load() with missing file", () => {
        it("returns without error when .livesync/ignore is absent", async () => {
            const vaultPath = await createVault();
            // No ignore file created
            const rules = new IgnoreRules(vaultPath);
            await expect(rules.load()).resolves.toBeUndefined();
            expect(rules.shouldIgnore("anything.md")).toBe(false);
        });
    });

    describe("load() with comments and blank lines", () => {
        it("skips # comment lines and blank lines", async () => {
            const vaultPath = await createVault();
            await writeIgnoreFile(
                vaultPath,
                "# This is a comment\n\n  \n*.tmp\n# another comment\nbuild/\n"
            );
            const rules = new IgnoreRules(vaultPath);
            await rules.load();
            const globs = rules.asGlobs();
            expect(globs).toHaveLength(2);
        });
    });

    describe("import: .gitignore directive", () => {
        it("reads and normalises patterns from .gitignore", async () => {
            const vaultPath = await createVault();
            await writeIgnoreFile(vaultPath, "import: .gitignore\n");
            await fs.writeFile(path.join(vaultPath, ".gitignore"), "*.log\nnode_modules/\n", "utf-8");
            const rules = new IgnoreRules(vaultPath);
            await rules.load();
            expect(rules.shouldIgnore("app.log")).toBe(true);
            expect(rules.shouldIgnore("node_modules/package.json")).toBe(true);
            expect(rules.shouldIgnore("src/node_modules/package.json")).toBe(true);
            expect(rules.shouldIgnore("src/index.ts")).toBe(false);
        });

        it("merges .gitignore patterns with other patterns", async () => {
            const vaultPath = await createVault();
            await writeIgnoreFile(vaultPath, "*.tmp\nimport: .gitignore\n");
            await fs.writeFile(path.join(vaultPath, ".gitignore"), "*.log\n", "utf-8");
            const rules = new IgnoreRules(vaultPath);
            await rules.load();
            expect(rules.shouldIgnore("scratch.tmp")).toBe(true);
            expect(rules.shouldIgnore("error.log")).toBe(true);
        });
    });

    describe("import: .gitignore with missing .gitignore", () => {
        it("does not throw when .gitignore is absent", async () => {
            const vaultPath = await createVault();
            await writeIgnoreFile(vaultPath, "*.tmp\nimport: .gitignore\n");
            // No .gitignore created
            const rules = new IgnoreRules(vaultPath);
            await expect(rules.load()).resolves.toBeUndefined();
            // The *.tmp pattern from the ignore file still works
            expect(rules.shouldIgnore("scratch.tmp")).toBe(true);
        });
    });
});
