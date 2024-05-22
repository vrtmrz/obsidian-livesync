import { Trench } from "../lib/src/memory/memutil.ts";
import type ObsidianLiveSyncPlugin from "../main.ts";
type MeasureResult = [times: number, spent: number];
type NamedMeasureResult = [name: string, result: MeasureResult];
const measures = new Map<string, MeasureResult>();

function clearResult(name: string) {
    measures.set(name, [0, 0]);
}
async function measureEach(name: string, proc: () => (void | Promise<void>)) {
    const [times, spent] = measures.get(name) ?? [0, 0];

    const start = performance.now();
    const result = proc();
    if (result instanceof Promise) await result;
    const end = performance.now();
    measures.set(name, [times + 1, spent + (end - start)]);

}
function formatNumber(num: number) {
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
async function measure(name: string, proc: () => (void | Promise<void>), times: number = 10000, duration: number = 1000): Promise<NamedMeasureResult> {
    const from = Date.now();
    let last = times;
    clearResult(name);
    do {
        await measureEach(name, proc);
    } while (last-- > 0 && (Date.now() - from) < duration)
    return [name, measures.get(name) as MeasureResult];
}

// eslint-disable-next-line require-await
async function formatPerfResults(items: NamedMeasureResult[]) {
    return `| Name | Runs | Each | Total |\n| --- | --- | --- | --- | \n` + items.map(e => `| ${e[0]} | ${e[1][0]} | ${e[1][0] != 0 ? formatNumber(e[1][1] / e[1][0]) : "-"} | ${formatNumber(e[1][0])} |`).join("\n");
}
export async function perf_trench(plugin: ObsidianLiveSyncPlugin) {
    clearResult("trench");
    const trench = new Trench(plugin.simpleStore);
    const result = [] as NamedMeasureResult[];
    result.push(await measure("trench-short-string", async () => {
        const p = trench.evacuate("string");
        await p();
    }));
    {
        const testBinary = await plugin.vaultAccess.adapterReadBinary("testdata/10kb.png");
        const uint8Array = new Uint8Array(testBinary);
        result.push(await measure("trench-binary-10kb", async () => {
            const p = trench.evacuate(uint8Array);
            await p();
        }));
    }
    {
        const testBinary = await plugin.vaultAccess.adapterReadBinary("testdata/100kb.jpeg");
        const uint8Array = new Uint8Array(testBinary);
        result.push(await measure("trench-binary-100kb", async () => {
            const p = trench.evacuate(uint8Array);
            await p();
        }));
    }
    {
        const testBinary = await plugin.vaultAccess.adapterReadBinary("testdata/1mb.png");
        const uint8Array = new Uint8Array(testBinary);
        result.push(await measure("trench-binary-1mb", async () => {
            const p = trench.evacuate(uint8Array);
            await p();
        }));
    }
    return formatPerfResults(result);
}