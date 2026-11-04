import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const workflowPath = join(repositoryRoot, '.github/workflows/library-preview.yml');
const workflow = readFileSync(workflowPath, 'utf8');
const fullSha = 'a'.repeat(40);

function readValidationProgram() {
  const lines = workflow.split(/\r?\n/);
  const stepIndex = lines.findIndex((line) => line.trim() === '- name: Validate preview SHAs and resolve the consumer commit');
  assert.notEqual(stepIndex, -1, 'workflow must contain the SHA validation step');

  const runIndex = lines.findIndex((line, index) => index > stepIndex && line === '        run: |');
  assert.notEqual(runIndex, -1, 'SHA validation step must use a literal run block');

  const scriptLines = [];
  for (let index = runIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') {
      scriptLines.push('');
      continue;
    }
    if (!line.startsWith('          ')) break;
    scriptLines.push(line.slice(10));
  }

  const shellScript = scriptLines.join('\n').trimEnd();
  const heredoc = shellScript.match(/^node --input-type=module <<'NODE'\n([\s\S]*)\nNODE$/);
  assert.ok(heredoc, 'SHA validation must pass its literal Node program through a quoted heredoc');
  return heredoc[1];
}

const validationProgram = readValidationProgram();

function runValidation(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'library-preview-inputs-'));
  const outputPath = join(directory, 'output');
  const summaryPath = join(directory, 'summary');
  const env = {
    ...process.env,
    INPUT_COMMONLIB_SHA: '',
    INPUT_KIT_SHA: '',
    INPUT_CONSUMER_SHA: '',
    CALLER_REPOSITORY: 'vrtmrz/obsidian-livesync',
    CALLER_SHA: fullSha,
    GITHUB_OUTPUT: outputPath,
    GITHUB_STEP_SUMMARY: summaryPath,
    ...overrides,
  };
  appendFileSync(outputPath, '');
  appendFileSync(summaryPath, '');

  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', validationProgram], {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
  });
  const outputs = readFileSync(outputPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(/=(.*)/s).slice(0, 2));
  const summary = readFileSync(summaryPath, 'utf8');

  rmSync(directory, { recursive: true, force: true });
  return {
    ...result,
    outputs: Object.fromEntries(outputs),
    summary,
  };
}

test('blank library SHAs resolve the caller commit for the LiveSync repository', () => {
  const result = runValidation();

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.outputs, {
    commonlib_sha: '',
    kit_sha: '',
    consumer_sha: fullSha,
  });
  assert.match(result.summary, new RegExp(fullSha));
});

test('a reusable workflow caller from another repository must pass consumer_sha', () => {
  const result = runValidation({ CALLER_REPOSITORY: 'vrtmrz/livesync-commonlib' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /consumer_sha is required/);
});

test('an explicit consumer SHA is accepted for an external caller', () => {
  const consumerSha = 'b'.repeat(40);
  const result = runValidation({
    CALLER_REPOSITORY: 'vrtmrz/livesync-commonlib',
    INPUT_COMMONLIB_SHA: fullSha,
    INPUT_KIT_SHA: 'c'.repeat(40),
    INPUT_CONSUMER_SHA: consumerSha,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.outputs, {
    commonlib_sha: fullSha,
    kit_sha: 'c'.repeat(40),
    consumer_sha: consumerSha,
  });
});

test('a supplied consumer SHA takes precedence over the caller commit', () => {
  const consumerSha = 'b'.repeat(40);
  const result = runValidation({ INPUT_CONSUMER_SHA: consumerSha });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs.consumer_sha, consumerSha);
});

test('all supplied SHAs reject anything other than a full lowercase hexadecimal SHA', async (t) => {
  const invalidValues = ['main', 'ABCDEF0123456789abcdef0123456789abcdef01', 'a'.repeat(39), `${fullSha}\n`];

  for (const [inputName, displayName] of [
    ['INPUT_COMMONLIB_SHA', 'commonlib_sha'],
    ['INPUT_KIT_SHA', 'kit_sha'],
    ['INPUT_CONSUMER_SHA', 'consumer_sha'],
  ]) {
    await t.test(displayName, async (inputTest) => {
      for (const invalidValue of invalidValues) {
        await inputTest.test(JSON.stringify(invalidValue), () => {
          const result = runValidation({ [inputName]: invalidValue });

          assert.notEqual(result.status, 0);
          assert.match(result.stderr, new RegExp(`${inputName} must be blank or a full 40-character lowercase SHA`));
        });
      }
    });
  }
});

test('workflow exposes the specified inputs, read-only permissions, and independently pinned actions', () => {
  assert.match(workflow, /^  workflow_call:\n    inputs:/m);
  assert.match(workflow, /^  workflow_dispatch:\n    inputs:/m);
  for (const input of ['commonlib_sha', 'kit_sha', 'consumer_sha']) {
    assert.match(workflow, new RegExp(`^      ${input}:`, 'm'));
  }
  assert.match(workflow, /^permissions:\n  actions: read\n  contents: read$/m);
  assert.doesNotMatch(workflow, /^\s+(actions|contents): write$/m);
  assert.doesNotMatch(workflow, /pull_request_target|secrets:\s*inherit/);

  for (const actionRef of [
    'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
    'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
    'denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed',
  ]) {
    assert.ok(workflow.includes(actionRef), `workflow must pin ${actionRef}`);
  }
  assert.match(workflow, /^        uses: vrtmrz\/fancy-kit\/\.github\/actions\/install-library-preview@[0-9a-f]{40}(?:\s+#.*)?$/m);
  assert.match(workflow, /repository: vrtmrz\/obsidian-livesync\n\s+ref: \$\{\{ steps\.inputs\.outputs\.consumer_sha \}\}/);
  assert.match(workflow, /commonlib-sha: \$\{\{ steps\.inputs\.outputs\.commonlib_sha \}\}/);
  assert.match(workflow, /kit-sha: \$\{\{ steps\.inputs\.outputs\.kit_sha \}\}/);
  assert.match(workflow, /github-token: \$\{\{ github\.token \}\}/);
});

test('consumer workflow runs all required checks and keeps input values out of shell source', () => {
  for (const command of [
    'npm ci',
    'npm run tsc-check',
    'npm run test:unit -- --maxWorkers=1',
    'npm run build',
    'npm run build --workspace self-hosted-livesync-cli',
    'npm run build --workspace livesync-webapp',
    'npm run build --workspace webpeer',
    'deno task --cwd src/apps/cli/testdeno test:setup-put-cat',
  ]) {
    assert.ok(workflow.includes(command), `workflow must run ${command}`);
  }
  assert.match(workflow, /INPUT_COMMONLIB_SHA: \$\{\{ inputs\.commonlib_sha \}\}/);
  assert.match(workflow, /INPUT_KIT_SHA: \$\{\{ inputs\.kit_sha \}\}/);
  assert.match(workflow, /INPUT_CONSUMER_SHA: \$\{\{ inputs\.consumer_sha \}\}/);
  assert.doesNotMatch(validationProgram, /\$\{\{\s*inputs\./);
});
