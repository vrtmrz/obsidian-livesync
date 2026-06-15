import * as acorn from "acorn";
import fs from "fs";

// Parse command line arguments
const args = process.argv.slice(2);
let file = "main.js";
let target = 2018;
let ios = null;

// Help menu
if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: node utils/check-compatibility.js [options]
Options:
  --file <path>                  Path to the bundle file to check (default: main.js)
  --target <year>                Target ECMAScript version (default: 2018)
  --ios <version>                Target iOS version (e.g. 14, 15, 16.4). Sets defaults automatically.
  --[no-]allow-dynamic-import    Allow dynamic import() expressions
  --[no-]allow-bigint            Allow BigInt literals
  --[no-]allow-numeric-separator  Allow numeric separators (e.g. 1_000)
  --[no-]allow-class-fields      Allow public/private/static class fields
  --[no-]allow-class-static-blocks Allow class static initialization blocks
  --[no-]allow-regexp-lookbehind Allow RegExp lookbehind assertions ((?<=...) / (?<!...))
  --[no-]allow-regexp-indices    Allow RegExp 'd' (indices) flag
  --[no-]allow-regexp-v-flag     Allow RegExp 'v' (Unicode properties) flag
`);
    process.exit(0);
}

for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) {
        file = args[i + 1];
        i++;
    } else if (args[i] === "--target" && args[i + 1]) {
        target = parseInt(args[i + 1], 10);
        i++;
    } else if (args[i] === "--ios" && args[i + 1]) {
        ios = parseFloat(args[i + 1]);
        i++;
    }
}

// Default feature flags based on target ECMA version
let allowDynamicImport = target >= 2020;
let allowBigInt = target >= 2020;
let allowNumericSeparator = target >= 2021;
let allowClassFields = target >= 2022;
let allowClassStaticBlocks = target >= 2022;
let allowRegexpLookbehind = target >= 2023;
let allowRegexpIndices = target >= 2022;
let allowRegexpVFlag = target >= 2024;

// Override feature flags if target iOS version is specified
if (ios !== null) {
    // Determine a general baseline ECMA version for parser reports
    if (ios >= 16.4) target = 2022;
    else if (ios >= 15.0) target = 2021;
    else if (ios >= 14.0) target = 2020;
    else target = 2018;

    allowDynamicImport = ios >= 11.3;
    allowBigInt = ios >= 14.0;
    allowNumericSeparator = ios >= 14.0;
    allowClassFields = ios >= 14.5;
    allowRegexpIndices = ios >= 15.0;
    allowClassStaticBlocks = ios >= 16.4;
    allowRegexpLookbehind = ios >= 16.4;
    allowRegexpVFlag = ios >= 17.0;
}

// Override defaults with explicit command line options if specified
for (let i = 0; i < args.length; i++) {
    if (args[i] === "--allow-dynamic-import") allowDynamicImport = true;
    else if (args[i] === "--no-allow-dynamic-import") allowDynamicImport = false;
    else if (args[i] === "--allow-bigint") allowBigInt = true;
    else if (args[i] === "--no-allow-bigint") allowBigInt = false;
    else if (args[i] === "--allow-numeric-separator") allowNumericSeparator = true;
    else if (args[i] === "--no-allow-numeric-separator") allowNumericSeparator = false;
    else if (args[i] === "--allow-class-fields") allowClassFields = true;
    else if (args[i] === "--no-allow-class-fields") allowClassFields = false;
    else if (args[i] === "--allow-class-static-blocks") allowClassStaticBlocks = true;
    else if (args[i] === "--no-allow-class-static-blocks") allowClassStaticBlocks = false;
    else if (args[i] === "--allow-regexp-lookbehind") allowRegexpLookbehind = true;
    else if (args[i] === "--no-allow-regexp-lookbehind") allowRegexpLookbehind = false;
    else if (args[i] === "--allow-regexp-indices") allowRegexpIndices = true;
    else if (args[i] === "--no-allow-regexp-indices") allowRegexpIndices = false;
    else if (args[i] === "--allow-regexp-v-flag") allowRegexpVFlag = true;
    else if (args[i] === "--no-allow-regexp-v-flag") allowRegexpVFlag = false;
}

if (!fs.existsSync(file)) {
    console.error(`Error: File '${file}' does not exist.`);
    process.exit(1);
}

const code = fs.readFileSync(file, "utf8");
let ast;

const targetInfo = ios !== null ? `iOS ${ios}` : `ES${target}`;
console.log(`Parsing '${file}' to inspect compatibility (target ${targetInfo})...`);
console.log(`Rules:
  Dynamic Import:     ${allowDynamicImport ? "Allowed" : "Prohibited"}
  BigInt:             ${allowBigInt ? "Allowed" : "Prohibited"}
  Numeric Separators: ${allowNumericSeparator ? "Allowed" : "Prohibited"}
  Class Fields:       ${allowClassFields ? "Allowed" : "Prohibited"}
  Class Static Block: ${allowClassStaticBlocks ? "Allowed" : "Prohibited"}
  RegExp Lookbehind:  ${allowRegexpLookbehind ? "Allowed" : "Prohibited"}
  RegExp Indices (d): ${allowRegexpIndices ? "Allowed" : "Prohibited"}
  RegExp Unicode (v): ${allowRegexpVFlag ? "Allowed" : "Prohibited"}
`);

try {
    ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "script" });
} catch (err) {
    console.error(`Syntax Error: Failed to parse '${file}' due to a syntax issue:`);
    console.error(err.message);
    if (err.pos !== undefined) {
        const line = code.substring(0, err.pos).split("\n").length;
        console.error(`Location: line ${line}, character ${err.pos}`);
        const start = Math.max(0, err.pos - 50);
        const end = Math.min(code.length, err.pos + 50);
        console.error("Context around error:");
        console.error(code.substring(start, end));
        console.error(" ".repeat(err.pos - start) + "^");
    }
    process.exit(1);
}

// Violations list
const violations = [];

function hasLookbehind(pattern) {
    let index = 0;
    while (true) {
        const match = pattern.indexOf("(?<=", index);
        const match2 = pattern.indexOf("(?<!", index);
        const pos = match !== -1 && match2 !== -1 ? Math.min(match, match2) : match !== -1 ? match : match2;
        if (pos === -1) break;

        let backslashes = 0;
        for (let i = pos - 1; i >= 0; i--) {
            if (pattern[i] === "\\") backslashes++;
            else break;
        }
        if (backslashes % 2 === 0) {
            return true;
        }
        index = pos + 4;
    }
    return false;
}

function checkNode(node) {
    if (!node || typeof node !== "object") return;

    if (node.type) {
        // 1. Optional catch binding (ES2019 / iOS 11.3+)
        if (node.type === "CatchClause" && !node.param) {
            if (target < 2019 && ios === null) {
                violations.push({
                    feature: "Optional catch binding (ES2019 / iOS 11.3+)",
                    pos: node.start,
                    node,
                });
            } else if (ios !== null && ios < 11.3) {
                violations.push({
                    feature: "Optional catch binding (iOS 11.3+)",
                    pos: node.start,
                    node,
                });
            }
        }

        // 2. Dynamic import (ES2020 / iOS 11.3+)
        if (node.type === "ImportExpression") {
            if (!allowDynamicImport) {
                violations.push({
                    feature: "Dynamic import (ES2020 / iOS 11.3+)",
                    pos: node.start,
                    node,
                });
            }
        }

        // 3. import.meta (ES2020 / iOS 11.3+)
        if (node.type === "MetaProperty" && node.meta && node.meta.name === "import") {
            if (!allowDynamicImport) {
                violations.push({
                    feature: "import.meta (ES2020 / iOS 11.3+)",
                    pos: node.start,
                    node,
                });
            }
        }

        // 4. Optional chaining (ES2020 / iOS 13.4+)
        if (node.type === "ChainExpression") {
            const isProhibited = ios !== null ? ios < 13.4 : target < 2020;
            if (isProhibited) {
                violations.push({
                    feature: "Optional chaining (ES2020 / iOS 13.4+)",
                    pos: node.start,
                    node,
                });
            }
        }

        // 5. Nullish coalescing (ES2020 / iOS 13.4+)
        if (node.type === "LogicalExpression" && node.operator === "??") {
            const isProhibited = ios !== null ? ios < 13.4 : target < 2020;
            if (isProhibited) {
                violations.push({
                    feature: "Nullish coalescing (ES2020 / iOS 13.4+)",
                    pos: node.start,
                    node,
                });
            }
        }

        // 6. BigInt literal (ES2020 / iOS 14.0+)
        if (node.type === "Literal" && node.bigint !== undefined) {
            if (!allowBigInt) {
                violations.push({
                    feature: "BigInt literal (ES2020 / iOS 14.0+)",
                    pos: node.start,
                    node,
                });
            }
        }

        // 7. Logical assignment (ES2021 / iOS 14.0+)
        if (node.type === "AssignmentExpression" && ["||=", "&&=", "??="].includes(node.operator)) {
            const isProhibited = ios !== null ? ios < 14.0 : target < 2021;
            if (isProhibited) {
                violations.push({
                    feature: `Logical assignment operator '${node.operator}' (ES2021 / iOS 14.0+)`,
                    pos: node.start,
                    node,
                });
            }
        }

        // 8. Numeric separators (ES2021 / iOS 14.0+)
        if (node.type === "Literal" && typeof node.value === "number" && node.raw && node.raw.includes("_")) {
            if (!allowNumericSeparator) {
                violations.push({
                    feature: "Numeric separator (ES2021 / iOS 14.0+)",
                    pos: node.start,
                    node,
                });
            }
        }

        // 9. Class Fields (ES2022 / iOS 14.0+ public, iOS 14.5+ private/static)
        if (node.type === "PropertyDefinition") {
            if (!allowClassFields) {
                const requiredVersion =
                    node.key.type === "PrivateIdentifier" || node.static ? "iOS 14.5+" : "iOS 14.0+";
                violations.push({
                    feature: `Class field definition '${node.key.name || node.key.value || "#private"}' (ES2022 / ${requiredVersion})`,
                    pos: node.start,
                    node,
                });
            }
        }

        // 10. Class Static Initialization Blocks (ES2022 / iOS 16.4+)
        if (node.type === "StaticBlock") {
            if (!allowClassStaticBlocks) {
                violations.push({
                    feature: "Class static initialization block (ES2022 / iOS 16.4+)",
                    pos: node.start,
                    node,
                });
            }
        }

        // 11. RegExp lookbehind assertions (ES2018 / iOS 16.4+)
        if (node.type === "Literal" && node.regex) {
            if (!allowRegexpLookbehind && hasLookbehind(node.regex.pattern)) {
                violations.push({
                    feature: "RegExp Lookbehind assertion (iOS 16.4+)",
                    pos: node.start,
                    node,
                });
            }
            if (!allowRegexpIndices && node.regex.flags.includes("d")) {
                violations.push({
                    feature: "RegExp 'd' (indices) flag (ES2022 / iOS 15.0+)",
                    pos: node.start,
                    node,
                });
            }
            if (!allowRegexpVFlag && node.regex.flags.includes("v")) {
                violations.push({
                    feature: "RegExp 'v' (Unicode properties) flag (ES2024 / iOS 17.0+)",
                    pos: node.start,
                    node,
                });
            }
        }

        if (
            (node.type === "NewExpression" || node.type === "CallExpression") &&
            node.callee &&
            node.callee.name === "RegExp"
        ) {
            if (
                !allowRegexpLookbehind &&
                node.arguments[0] &&
                node.arguments[0].type === "Literal" &&
                typeof node.arguments[0].value === "string"
            ) {
                if (hasLookbehind(node.arguments[0].value)) {
                    violations.push({
                        feature: "RegExp Lookbehind assertion (iOS 16.4+)",
                        pos: node.start,
                        node,
                    });
                }
            }
            if (
                node.arguments[1] &&
                node.arguments[1].type === "Literal" &&
                typeof node.arguments[1].value === "string"
            ) {
                const flags = node.arguments[1].value;
                if (!allowRegexpIndices && flags.includes("d")) {
                    violations.push({
                        feature: "RegExp 'd' (indices) flag (ES2022 / iOS 15.0+)",
                        pos: node.start,
                        node,
                    });
                }
                if (!allowRegexpVFlag && flags.includes("v")) {
                    violations.push({
                        feature: "RegExp 'v' (Unicode properties) flag (ES2024 / iOS 17.0+)",
                        pos: node.start,
                        node,
                    });
                }
            }
        }
    }

    for (const key in node) {
        if (key === "loc" || key === "start" || key === "end") continue;
        const val = node[key];
        if (Array.isArray(val)) {
            for (const child of val) {
                checkNode(child);
            }
        } else if (val && typeof val === "object") {
            checkNode(val);
        }
    }
}

// Run compatibility checks on the AST
checkNode(ast);

if (violations.length > 0) {
    console.error(`\nCompatibility Check Failed: Found ${violations.length} prohibited features.`);
    violations.forEach((v, index) => {
        const line = code.substring(0, v.pos).split("\n").length;
        console.error(`\n[${index + 1}] Prohibited feature: ${v.feature}`);
        console.error(`Location: line ${line}, character ${v.pos}`);
        const start = Math.max(0, v.pos - 50);
        const end = Math.min(code.length, v.pos + 50);
        console.error("Context around feature:");
        console.error(code.substring(start, end));
        console.error(" ".repeat(v.pos - start) + "^");
    });
    process.exit(1);
}

console.log(`\nCompatibility Check Passed: '${file}' matches the compatibility rules.`);
process.exit(0);
