import assert from "node:assert/strict";
import test from "node:test";
import { runProcess, spawnProcess } from "./process.ts";

test("subprocesses preserve arguments, environment overrides, and both output streams", async () => {
    const argument = "a path with spaces/日本語.txt";
    const result = await runProcess(process.execPath, {
        args: [
            "--eval",
            "process.stdout.write(JSON.stringify({arg:process.argv[1],value:process.env.LIVESYNC_PROCESS_TEST,inherited:process.env.PATH||process.env.Path}));process.stderr.write('diagnostic');process.exitCode=7",
            argument,
        ],
        env: { LIVESYNC_PROCESS_TEST: "override" },
    });
    assert.equal(result.code, 7);
    assert.equal(result.success, false);
    const output = JSON.parse(new TextDecoder().decode(result.stdout));
    assert.equal(output.arg, argument);
    assert.equal(output.value, "override");
    assert.ok(output.inherited);
    assert.equal(new TextDecoder().decode(result.stderr), "diagnostic");
});

test("piped stdin closes and large stdout and stderr drain before completion", async () => {
    const child = spawnProcess(process.execPath, {
        args: [
            "--eval",
            "let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>data+=v);process.stdin.on('end',()=>{process.stdout.write(data.repeat(100000));process.stderr.write('e'.repeat(100000));})",
        ],
        stdin: "piped",
    });
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode("abc"));
    await writer.close();
    const [status, out, err] = await Promise.all([child.status, stdout, stderr]);
    assert.equal(status.success, true);
    assert.equal(out, "abc".repeat(100000));
    assert.equal(err, "e".repeat(100000));
});

test("a missing executable rejects with its OS error", async () => {
    await assert.rejects(runProcess("livesync-missing-test-executable-847281"), { code: "ENOENT" });
});
