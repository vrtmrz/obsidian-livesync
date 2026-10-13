import path from "node:path";

/**
 * @param {string} sourcePath
 * @param {string} filename
 * @param {string} cwd
 * @param {string} sourceRoot
 * @returns {string | null}
 */
export function resolveSourceAlias(sourcePath, filename, cwd, sourceRoot = "./src") {
    if (!/^(?:\.\/)?\.\.(?:\/|$)/u.test(sourcePath)) return null;
    const paths = /^[A-Za-z]:[\\/]|^\\\\/u.test(filename) ? path.win32 : path;
    const root = paths.resolve(cwd, sourceRoot);
    const importedPath = paths.resolve(paths.dirname(filename), sourcePath);
    const relative = paths.relative(root, importedPath);
    if (relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative)) return null;
    return relative ? `@/${relative.split(paths.sep).join("/")}` : "@";
}

/** @type {import("eslint").Rule.RuleModule} */
const preferSourceAlias = {
    meta: {
        type: "suggestion",
        fixable: "code",
        docs: { description: "Prefer the source alias for relative parent imports within this repository" },
        schema: [
            {
                type: "object",
                properties: { sourceRoot: { type: "string" } },
                additionalProperties: false,
            },
        ],
        messages: {
            parentImport: "Unexpected parent import '{{sourcePath}}'. Use '{{rewrittenImport}}' instead",
        },
    },
    create(context) {
        if (context.filename === "<text>" || context.filename === "<input>") return {};
        return {
            ImportDeclaration(node) {
                const sourcePath = node.source.value;
                if (typeof sourcePath !== "string") return;
                const rewrittenImport = resolveSourceAlias(
                    sourcePath,
                    context.filename,
                    context.cwd,
                    context.options[0]?.sourceRoot
                );
                if (rewrittenImport === null) return;
                context.report({
                    node,
                    messageId: "parentImport",
                    data: { sourcePath, rewrittenImport },
                    fix: (fixer) =>
                        fixer.replaceTextRange([node.source.range[0] + 1, node.source.range[1] - 1], rewrittenImport),
                });
            },
        };
    },
};

export default { rules: { "prefer-source-alias": preferSourceAlias } };
