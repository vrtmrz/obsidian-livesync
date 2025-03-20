<script lang="ts">
    export let patterns = [] as string[];
    export let originals = [] as string[];

    export let apply: (args: string[]) => Promise<void> = (_: string[]) => Promise.resolve();
    function revert() {
        patterns = [...originals];
    }
    const CHECK_OK = "✔";
    const CHECK_NG = "⚠";
    const MARK_MODIFIED = "✏ ";
    function checkRegExp(pattern: string) {
        if (pattern.trim() == "") return "";
        try {
            new RegExp(pattern);
            return CHECK_OK;
        } catch (ex) {
            return CHECK_NG;
        }
    }
    $: statusName = patterns.map((e) => checkRegExp(e));
    $: modified = patterns.map((e, i) => (e != (originals?.[i] ?? "") ? MARK_MODIFIED : ""));

    function remove(idx: number) {
        patterns[idx] = "";
    }
    function add() {
        patterns = [...patterns, ""];
    }
</script>

<ul>
    {#each patterns as pattern, idx}
        <!-- svelte-ignore a11y-label-has-associated-control -->
        <li>
            <label>{modified[idx]}{statusName[idx]}</label><input type="text" bind:value={pattern} class={modified[idx]} />
            <button class="iconbutton" on:click={() => remove(idx)}>🗑</button>
        </li>
    {/each}
    <li>
        <label>
            <button on:click={() => add()}>Add</button>
        </label>
    </li>
    <li class="buttons">
        <button on:click={() => apply(patterns)} disabled={statusName.some((e) => e === CHECK_NG) || modified.every((e) => e === "")}>Apply </button>
        <button on:click={() => revert()} disabled={statusName.some((e) => e === CHECK_NG) || modified.every((e) => e === "")}>Revert </button>
    </li>
</ul>

<style>
    label {
        min-width: 4em;
        width: 4em;
        display: inline-flex;
        flex-direction: row;
        justify-content: flex-end;
    }

    ul {
        flex-grow: 1;
        display: inline-flex;
        flex-direction: column;
        list-style-type: none;
        margin-block-start: 0;
        margin-block-end: 0;
        margin-inline-start: 0;
        margin-inline-end: 0;
        padding-inline-start: 0;
    }

    li {
        padding: var(--size-2-1) var(--size-4-1);
        display: inline-flex;
        flex-grow: 1;
        align-items: center;
        justify-content: flex-end;
        gap: var(--size-4-2);
    }

    li input {
        min-width: 10em;
    }

    button.iconbutton {
        max-width: 4em;
    }
</style>
