import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(MODULE_DIR, "../..");
const SEED = 0x4c53594e;
const KIB = 1024;
const MIB = 1024 * KIB;
const BINARY_BYTES = 8 * MIB;
const SMALL_MARKDOWN_BYTES = 512 * KIB;
const LARGE_MARKDOWN_BYTES = 5 * MIB;
const BINARY_EDIT_BYTES = 4 * KIB;
const INITIAL_MTIME = new Date("2020-01-01T00:00:00.000Z");
const STAGE_MTIMES = {
  overwrite: new Date("2020-01-02T00:00:00.000Z"),
  insert: new Date("2020-01-03T00:00:00.000Z"),
};

const MARKDOWN_FILES = [
  "README.md",
  "devs.md",
  "docs/settings.md",
  "docs/troubleshooting.md",
  "docs/quick_setup.md",
  "docs/datastructure.md",
  "docs/p2p.md",
  "docs/tips/fast-setup.md",
  "docs/design_docs/intention_of_chunks.md",
  "docs/specs_data_compression.md",
];

const SNIPPET_FILES = [
  "docs/terms.md",
  "docs/glossary.md",
  "docs/quick_setup_ja.md",
  "docs/design_docs/unicode_path_identity.md",
  "docs/settings.md",
];

const CORPUS_PATHS = {
  markdownSmall: "benchmark/generated-small.md",
  markdownLarge: "benchmark/generated-large.md",
  binary: "benchmark/random-8m.bin",
  cloudantImage: "assets/cloudant-setup.png",
  setupImage: "assets/quick-setup-first-setup-uri.png",
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function createPrng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function makeRandomBytes(length, seed) {
  const next = createPrng(seed);
  const output = Buffer.allocUnsafe(length);
  for (let offset = 0; offset < length; offset += 4) {
    const value = next();
    output[offset] = value & 0xff;
    if (offset + 1 < length) output[offset + 1] = (value >>> 8) & 0xff;
    if (offset + 2 < length) output[offset + 2] = (value >>> 16) & 0xff;
    if (offset + 3 < length) output[offset + 3] = (value >>> 24) & 0xff;
  }
  return output;
}

function extractParagraphs(source) {
  const withoutFrontmatter = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "");
  return withoutFrontmatter
    .replace(/\r\n/gu, "\n")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => {
      if (paragraph.length < 80) return false;
      if (/^(?:#{1,6}\s|!\[|\|)/u.test(paragraph)) return false;
      return true;
    });
}

async function readSnippetParagraphs(repoRoot) {
  const excerpts = [];
  for (const file of SNIPPET_FILES) {
    const source = await readFile(path.join(repoRoot, file), "utf8");
    for (const paragraph of extractParagraphs(source)) {
      const excerpt = Array.from(paragraph).slice(0, 1000).join("");
      excerpts.push({ source: file, text: excerpt });
    }
  }
  if (excerpts.length === 0) throw new Error("No repository Markdown snippets were available.");
  return excerpts;
}

function buildGeneratedMarkdown({ targetBytes, title, variant, excerpts }) {
  const lines = [
    `# ${title}`,
    "",
    "A deterministic UTF-8 fixture contains varied passages from the project documentation.",
    "",
  ];
  let byteLength = Buffer.byteLength(lines.join("\n"), "utf8");
  const profiles = ["replication", "metadata", "recovery", "integrity", "configuration", "history", "incremental", "transport"];
  const unicodeLabels = ["résumé", "café", "日本語", "中文", "Δοκιμή", "ångström", "naïve", "雪", "λ", "mañana"];
  let record = 0;
  while (byteLength < targetBytes) {
    const excerpt = excerpts[(record * 7 + variant.length) % excerpts.length];
    const profile = profiles[(record * 3 + variant.length) % profiles.length];
    const unicode = unicodeLabels[(record * 5 + variant.length) % unicodeLabels.length];
    const tag = ((SEED ^ (record * 0x9e3779b1)) >>> 0).toString(16).padStart(8, "0");
    const paragraph = [
      `## Record ${String(record + 1).padStart(6, "0")} · ${profile} · ${variant}`,
      "",
      excerpt.text,
      "",
      `Fixture label ${tag} uses ${unicode}; source excerpt: ${excerpt.source}; revision ${record % 97}.`,
      "",
    ].join("\n");
    lines.push(paragraph);
    byteLength += Buffer.byteLength(paragraph, "utf8");
    record += 1;
  }
  return lines.join("\n");
}

function insertNearStart(markdown, paragraph) {
  const firstGap = markdown.indexOf("\n\n");
  const introGap = markdown.indexOf("\n\n", firstGap + 2);
  if (firstGap < 0 || introGap < 0) throw new Error("Generated Markdown fixture has no introductory paragraph.");
  const insertionPoint = introGap + 2;
  return `${markdown.slice(0, insertionPoint)}${paragraph}\n\n${markdown.slice(insertionPoint)}`;
}

async function writeFileWithMtime(directory, relativePath, contents, mtime) {
  const outputPath = path.join(directory, relativePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, contents);
  await utimes(outputPath, mtime, mtime);
}

async function copyStage(sourceDirectory, targetDirectory, relativePaths) {
  for (const relativePath of relativePaths) {
    const sourcePath = path.join(sourceDirectory, relativePath);
    const targetPath = path.join(targetDirectory, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    const sourceStat = await stat(sourcePath);
    await copyFile(sourcePath, targetPath);
    await utimes(targetPath, sourceStat.atime, sourceStat.mtime);
  }
}

async function setMtime(directory, relativePath, mtime) {
  const outputPath = path.join(directory, relativePath);
  await utimes(outputPath, mtime, mtime);
}

async function listFiles(directory) {
  const files = [];
  async function visit(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        files.push(path.relative(directory, fullPath).split(path.sep).join("/"));
      }
    }
  }
  await visit(directory);
  return files.sort();
}

async function describeStage(stageName, stageDirectory, paths) {
  const files = [];
  for (const relativePath of paths) {
    const bytes = await readFile(path.join(stageDirectory, relativePath));
    files.push({ path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  return { name: stageName, directory: stageName, files };
}

export async function createCorpus(outDir, repoRoot = DEFAULT_REPO_ROOT) {
  const outputDirectory = path.resolve(outDir);
  const sourceRoot = path.resolve(repoRoot);
  const initialDirectory = path.join(outputDirectory, "initial");
  const overwriteDirectory = path.join(outputDirectory, "overwrite");
  const insertDirectory = path.join(outputDirectory, "insert");

  await mkdir(outputDirectory, { recursive: true });

  const initialContents = new Map();
  for (const relativePath of MARKDOWN_FILES) {
    initialContents.set(relativePath, await readFile(path.join(sourceRoot, relativePath)));
  }

  const excerpts = await readSnippetParagraphs(sourceRoot);
  initialContents.set(
    CORPUS_PATHS.markdownSmall,
    Buffer.from(
      buildGeneratedMarkdown({
        targetBytes: SMALL_MARKDOWN_BYTES,
        title: "Generated Markdown · 512 KiB",
        variant: "small",
        excerpts,
      }),
      "utf8",
    ),
  );
  initialContents.set(
    CORPUS_PATHS.markdownLarge,
    Buffer.from(
      buildGeneratedMarkdown({
        targetBytes: LARGE_MARKDOWN_BYTES,
        title: "Generated Markdown · 5 MiB",
        variant: "large",
        excerpts,
      }),
      "utf8",
    ),
  );
  initialContents.set(CORPUS_PATHS.binary, makeRandomBytes(BINARY_BYTES, SEED));
  initialContents.set(CORPUS_PATHS.cloudantImage, await readFile(path.join(sourceRoot, "instruction_images/cloudant_1.png")));
  initialContents.set(CORPUS_PATHS.setupImage, await readFile(path.join(sourceRoot, "images/quick-setup/guide-quick-setup-first-setup-uri.png")));

  const relativePaths = [...initialContents.keys()].sort();
  for (const [relativePath, contents] of initialContents) {
    await writeFileWithMtime(initialDirectory, relativePath, contents, INITIAL_MTIME);
  }

  await copyStage(initialDirectory, overwriteDirectory, relativePaths);
  const smallMarkdownPath = path.join(overwriteDirectory, CORPUS_PATHS.markdownSmall);
  const smallMarkdownBefore = await readFile(smallMarkdownPath, "utf8");
  const originalIntro = "A deterministic UTF-8 fixture contains varied passages from the project documentation.";
  const changedIntro = "A deterministic UTF-8 fixture records a short content update using varied project passages.";
  if (!smallMarkdownBefore.includes(originalIntro)) throw new Error("Could not locate the generated Markdown paragraph to overwrite.");
  await writeFile(smallMarkdownPath, smallMarkdownBefore.replace(originalIntro, changedIntro));
  const binaryPath = path.join(overwriteDirectory, CORPUS_PATHS.binary);
  const initialBinary = await readFile(binaryPath);
  const binaryOverwriteOffset = Math.floor(initialBinary.byteLength * 0.25);
  const overwrittenBinary = Buffer.from(initialBinary);
  makeRandomBytes(BINARY_EDIT_BYTES, (SEED ^ 0x00a55a5a) >>> 0).copy(overwrittenBinary, binaryOverwriteOffset);
  await writeFile(binaryPath, overwrittenBinary);
  const alternatePng = await readFile(path.join(sourceRoot, "instruction_images/cloudant_2.png"));
  await writeFile(path.join(overwriteDirectory, CORPUS_PATHS.cloudantImage), alternatePng);
  for (const relativePath of [CORPUS_PATHS.markdownSmall, CORPUS_PATHS.binary, CORPUS_PATHS.cloudantImage]) {
    await setMtime(overwriteDirectory, relativePath, STAGE_MTIMES.overwrite);
  }

  await copyStage(overwriteDirectory, insertDirectory, relativePaths);
  const insertedBinaryPath = path.join(insertDirectory, CORPUS_PATHS.binary);
  const overwrittenBinaryForInsert = await readFile(insertedBinaryPath);
  const binaryInsertOffset = Math.floor(overwrittenBinaryForInsert.byteLength * 0.25);
  const insertedBinary = Buffer.concat([
    overwrittenBinaryForInsert.subarray(0, binaryInsertOffset),
    makeRandomBytes(BINARY_EDIT_BYTES, (SEED ^ 0x005aa5a5) >>> 0),
    overwrittenBinaryForInsert.subarray(binaryInsertOffset),
  ]);
  await writeFile(insertedBinaryPath, insertedBinary);

  const insertedParagraphs = [
    [CORPUS_PATHS.markdownSmall, "The insert stage adds record 0047, profile delta-small, while retaining Unicode labels such as 日本語 and café."],
    [CORPUS_PATHS.markdownLarge, "The insert stage adds record 0913, profile delta-large, while retaining Unicode labels such as 中文 and Δοκιμή."],
  ];
  for (const [relativePath, paragraph] of insertedParagraphs) {
    const markdownPath = path.join(insertDirectory, relativePath);
    const markdown = await readFile(markdownPath, "utf8");
    await writeFile(markdownPath, insertNearStart(markdown, paragraph));
  }
  for (const relativePath of [CORPUS_PATHS.binary, ...insertedParagraphs.map(([relativePath]) => relativePath)]) {
    await setMtime(insertDirectory, relativePath, STAGE_MTIMES.insert);
  }

  const actualPaths = await listFiles(initialDirectory);
  for (const directory of [overwriteDirectory, insertDirectory]) {
    const stagePaths = await listFiles(directory);
    if (JSON.stringify(stagePaths) !== JSON.stringify(actualPaths)) {
      throw new Error(`Corpus stage ${path.basename(directory)} has different relative paths.`);
    }
  }

  const sourceForPath = new Map(MARKDOWN_FILES.map((file) => [file, `repo:${file}`]));
  sourceForPath.set(CORPUS_PATHS.markdownSmall, "generated:utf8-markdown-512KiB-from-repository-snippets");
  sourceForPath.set(CORPUS_PATHS.markdownLarge, "generated:utf8-markdown-5MiB-from-repository-snippets");
  sourceForPath.set(CORPUS_PATHS.binary, `generated:seeded-high-entropy-binary-seed-${SEED.toString(16)}`);
  sourceForPath.set(CORPUS_PATHS.cloudantImage, "repo:instruction_images/cloudant_1.png");
  sourceForPath.set(CORPUS_PATHS.setupImage, "repo:images/quick-setup/guide-quick-setup-first-setup-uri.png");

  const files = actualPaths.map((relativePath) => {
    const kind = relativePath.endsWith(".md") ? "markdown" : "binary";
    return { path: relativePath, kind, source: sourceForPath.get(relativePath) };
  });
  const stages = [
    await describeStage("initial", initialDirectory, actualPaths),
    await describeStage("overwrite", overwriteDirectory, actualPaths),
    await describeStage("insert", insertDirectory, actualPaths),
  ];
  const manifest = { seed: SEED, files, stages };
  await writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
