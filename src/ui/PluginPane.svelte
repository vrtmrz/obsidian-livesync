<script lang="ts">
    import { onMount } from "svelte";
    import ObsidianLiveSyncPlugin from "../main";
    import { type PluginDataExDisplay, pluginIsEnumerating, pluginList } from "../features/CmdConfigSync";
    import PluginCombo from "./components/PluginCombo.svelte";
    import { Menu } from "obsidian";
    import { unique } from "../lib/src/common/utils";
    import { MODE_SELECTIVE, MODE_AUTOMATIC, MODE_PAUSED, type SYNC_MODE, type PluginSyncSettingEntry } from "../lib/src/common/types";
    import { normalizePath } from "../deps";
    export let plugin: ObsidianLiveSyncPlugin;

    $: hideNotApplicable = false;
    $: thisTerm = plugin.deviceAndVaultName;

    const addOn = plugin.addOnConfigSync;

    let list: PluginDataExDisplay[] = [];

    let selectNewestPulse = 0;
    let hideEven = false;
    let loading = false;
    let applyAllPluse = 0;
    let isMaintenanceMode = false;
    async function requestUpdate() {
        await addOn.updatePluginList(true);
    }
    async function requestReload() {
        await addOn.reloadPluginList(true);
    }
    let allTerms = [] as string[];
    pluginList.subscribe((e) => {
        list = e;
        allTerms = unique(list.map((e) => e.term));
    });
    pluginIsEnumerating.subscribe((e) => {
        loading = e;
    });
    onMount(async () => {
        requestUpdate();
    });

    function filterList(list: PluginDataExDisplay[], categories: string[]) {
        const w = list.filter((e) => categories.indexOf(e.category) !== -1);
        return w.sort((a, b) => `${a.category}-${a.name}`.localeCompare(`${b.category}-${b.name}`));
    }

    function groupBy(items: PluginDataExDisplay[], key: string) {
        let ret = {} as Record<string, PluginDataExDisplay[]>;
        for (const v of items) {
            //@ts-ignore
            const k = (key in v ? v[key] : "") as string;
            ret[k] = ret[k] || [];
            ret[k].push(v);
        }
        for (const k in ret) {
            ret[k] = ret[k].sort((a, b) => `${a.category}-${a.name}`.localeCompare(`${b.category}-${b.name}`));
        }
        const w = Object.entries(ret);
        return w.sort(([a], [b]) => `${a}`.localeCompare(`${b}`));
    }

    const displays = {
        CONFIG: "Configuration",
        THEME: "Themes",
        SNIPPET: "Snippets",
    };
    async function scanAgain() {
        await addOn.scanAllConfigFiles(true);
        await requestUpdate();
    }
    async function replicate() {
        await plugin.replicate(true);
    }
    function selectAllNewest() {
        selectNewestPulse++;
    }
    function applyAll() {
        applyAllPluse++;
    }
    async function applyData(data: PluginDataExDisplay): Promise<boolean> {
        return await addOn.applyData(data);
    }
    async function compareData(docA: PluginDataExDisplay, docB: PluginDataExDisplay): Promise<boolean> {
        return await addOn.compareUsingDisplayData(docA, docB);
    }
    async function deleteData(data: PluginDataExDisplay): Promise<boolean> {
        return await addOn.deleteData(data);
    }
    function askMode(evt: MouseEvent, title: string, key: string) {
        const menu = new Menu();
        menu.addItem((item) => item.setTitle(title).setIsLabel(true));
        menu.addSeparator();
        const prevMode = automaticList.get(key) ?? MODE_SELECTIVE;
        for (const mode of [MODE_SELECTIVE, MODE_AUTOMATIC, MODE_PAUSED]) {
            menu.addItem((item) => {
                item.setTitle(`${getIcon(mode as SYNC_MODE)}:${TITLES[mode]}`)
                    .onClick((e) => {
                        if (mode === MODE_AUTOMATIC) {
                            askOverwriteModeForAutomatic(evt, key);
                        } else {
                            setMode(key, mode as SYNC_MODE);
                        }
                    })
                    .setChecked(prevMode == mode)
                    .setDisabled(prevMode == mode);
            });
        }
        menu.showAtMouseEvent(evt);
    }
    function applyAutomaticSync(key: string, direction: "pushForce" | "pullForce" | "safe") {
        setMode(key, MODE_AUTOMATIC);
        const configDir = normalizePath(plugin.app.vault.configDir);
        const files = (plugin.settings.pluginSyncExtendedSetting[key]?.files ?? []).map((e) => `${configDir}/${e}`);
        plugin.addOnHiddenFileSync.syncInternalFilesAndDatabase(direction, true, false, files);
    }
    function askOverwriteModeForAutomatic(evt: MouseEvent, key: string) {
        const menu = new Menu();
        menu.addItem((item) => item.setTitle("Initial Action").setIsLabel(true));
        menu.addSeparator();
        menu.addItem((item) => {
            item.setTitle(`↑: Overwrite Remote`).onClick((e) => {
                applyAutomaticSync(key, "pushForce");
            });
        })
            .addItem((item) => {
                item.setTitle(`↓: Overwrite Local`).onClick((e) => {
                    applyAutomaticSync(key, "pullForce");
                });
            })
            .addItem((item) => {
                item.setTitle(`⇅: Use newer`).onClick((e) => {
                    applyAutomaticSync(key, "safe");
                });
            });
        menu.showAtMouseEvent(evt);
    }

    $: options = {
        thisTerm,
        hideNotApplicable,
        selectNewest: selectNewestPulse,
        applyAllPluse,
        applyData,
        compareData,
        deleteData,
        plugin,
        isMaintenanceMode,
    };

    const ICON_EMOJI_PAUSED = `⛔`;
    const ICON_EMOJI_AUTOMATIC = `✨`;
    const ICON_EMOJI_SELECTIVE = `🔀`;

    const ICONS: { [key: number]: string } = {
        [MODE_SELECTIVE]: ICON_EMOJI_SELECTIVE,
        [MODE_PAUSED]: ICON_EMOJI_PAUSED,
        [MODE_AUTOMATIC]: ICON_EMOJI_AUTOMATIC,
    };
    const TITLES: { [key: number]: string } = {
        [MODE_SELECTIVE]: "Selective",
        [MODE_PAUSED]: "Ignore",
        [MODE_AUTOMATIC]: "Automatic",
    };
    const PREFIX_PLUGIN_ALL = "PLUGIN_ALL";
    const PREFIX_PLUGIN_DATA = "PLUGIN_DATA";
    const PREFIX_PLUGIN_MAIN = "PLUGIN_MAIN";
    function setMode(key: string, mode: SYNC_MODE) {
        if (key.startsWith(PREFIX_PLUGIN_ALL + "/")) {
            setMode(PREFIX_PLUGIN_DATA + key.substring(PREFIX_PLUGIN_ALL.length), mode);
            setMode(PREFIX_PLUGIN_MAIN + key.substring(PREFIX_PLUGIN_ALL.length), mode);
        }
        const files = unique(
            list
                .filter((e) => `${e.category}/${e.name}` == key)
                .map((e) => e.files)
                .flat()
                .map((e) => e.filename),
        );
        automaticList.set(key, mode);
        automaticListDisp = automaticList;
        if (!(key in plugin.settings.pluginSyncExtendedSetting)) {
            plugin.settings.pluginSyncExtendedSetting[key] = {
                key,
                mode,
                files: [],
            };
        }
        plugin.settings.pluginSyncExtendedSetting[key].files = files;
        plugin.settings.pluginSyncExtendedSetting[key].mode = mode;
        plugin.saveSettingData();
    }
    function getIcon(mode: SYNC_MODE) {
        if (mode in ICONS) {
            return ICONS[mode];
        } else {
            ("");
        }
    }
    let automaticList = new Map<string, SYNC_MODE>();
    let automaticListDisp = new Map<string, SYNC_MODE>();

    // apply current configuration to the dialogue
    for (const { key, mode } of Object.values(plugin.settings.pluginSyncExtendedSetting)) {
        automaticList.set(key, mode);
    }

    automaticListDisp = automaticList;

    let displayKeys: Record<string, string[]> = {};

    $: {
        const extraKeys = Object.keys(plugin.settings.pluginSyncExtendedSetting);
        displayKeys = [
            ...list,
            ...extraKeys
                .map((e) => `${e}///`.split("/"))
                .filter((e) => e[0] && e[1])
                .map((e) => ({ category: e[0], name: e[1], displayName: e[1] })),
        ]
            .sort((a, b) => (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name))
            .reduce((p, c) => ({ ...p, [c.category]: unique(c.category in p ? [...p[c.category], c.displayName ?? c.name] : [c.displayName ?? c.name]) }), {} as Record<string, string[]>);
    }

    let deleteTerm = "";

    async function deleteAllItems(term: string) {
        const deleteItems = list.filter((e) => e.term == term);
        for (const item of deleteItems) {
            await deleteData(item);
        }
        addOn.reloadPluginList(true);
    }
</script>

<div>
    <div>
        <div class="buttons">
            <button on:click={() => scanAgain()}>Scan changes</button>
            <button on:click={() => replicate()}>Sync once</button>
            <button on:click={() => requestUpdate()}>Refresh</button>
            {#if isMaintenanceMode}
                <button on:click={() => requestReload()}>Reload</button>
            {/if}
            <button on:click={() => selectAllNewest()}>Select All Shiny</button>
        </div>
        <div class="buttons">
            <button on:click={() => applyAll()}>Apply All</button>
        </div>
    </div>
    {#if loading}
        <div>
            <span>Updating list...</span>
        </div>
    {/if}
    <div class="list">
        {#if list.length == 0}
            <div class="center">No Items.</div>
        {:else}
            {#each Object.entries(displays).filter(([key, _]) => key in displayKeys) as [key, label]}
                <div>
                    <h3>{label}</h3>
                    {#each displayKeys[key] as name}
                        {@const bindKey = `${key}/${name}`}
                        {@const mode = automaticListDisp.get(bindKey) ?? MODE_SELECTIVE}
                        <div class="labelrow {hideEven ? 'hideeven' : ''}">
                            <div class="title">
                                <button class="status" on:click={(evt) => askMode(evt, `${key}/${name}`, bindKey)}>
                                    {getIcon(mode)}
                                </button>
                                <span class="name">{name}</span>
                            </div>
                            {#if mode == MODE_SELECTIVE}
                                <PluginCombo {...options} list={list.filter((e) => e.category == key && e.name == name)} hidden={false} />
                            {:else}
                                <div class="statusnote">{TITLES[mode]}</div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/each}
            <div>
                <h3>Plugins</h3>
                {#each groupBy(filterList(list, ["PLUGIN_MAIN", "PLUGIN_DATA", "PLUGIN_ETC"]), "name") as [name, listX]}
                    {@const bindKeyAll = `${PREFIX_PLUGIN_ALL}/${name}`}
                    {@const modeAll = automaticListDisp.get(bindKeyAll) ?? MODE_SELECTIVE}
                    {@const bindKeyMain = `${PREFIX_PLUGIN_MAIN}/${name}`}
                    {@const modeMain = automaticListDisp.get(bindKeyMain) ?? MODE_SELECTIVE}
                    {@const bindKeyData = `${PREFIX_PLUGIN_DATA}/${name}`}
                    {@const modeData = automaticListDisp.get(bindKeyData) ?? MODE_SELECTIVE}
                    <div class="labelrow {hideEven ? 'hideeven' : ''}">
                        <div class="title">
                            <button class="status" on:click={(evt) => askMode(evt, `${PREFIX_PLUGIN_ALL}/${name}`, bindKeyAll)}>
                                {getIcon(modeAll)}
                            </button>
                            <span class="name">{name}</span>
                        </div>
                        {#if modeAll == MODE_SELECTIVE}
                            <PluginCombo {...options} list={listX} hidden={true} />
                        {/if}
                    </div>
                    {#if modeAll == MODE_SELECTIVE}
                        <div class="filerow {hideEven ? 'hideeven' : ''}">
                            <div class="filetitle">
                                <button class="status" on:click={(evt) => askMode(evt, `${PREFIX_PLUGIN_MAIN}/${name}/MAIN`, bindKeyMain)}>
                                    {getIcon(modeMain)}
                                </button>
                                <span class="name">MAIN</span>
                            </div>
                            {#if modeMain == MODE_SELECTIVE}
                                <PluginCombo {...options} list={filterList(listX, ["PLUGIN_MAIN"])} hidden={false} />
                            {:else}
                                <div class="statusnote">{TITLES[modeMain]}</div>
                            {/if}
                        </div>
                        <div class="filerow {hideEven ? 'hideeven' : ''}">
                            <div class="filetitle">
                                <button class="status" on:click={(evt) => askMode(evt, `${PREFIX_PLUGIN_DATA}/${name}`, bindKeyData)}>
                                    {getIcon(modeData)}
                                </button>
                                <span class="name">DATA</span>
                            </div>
                            {#if modeData == MODE_SELECTIVE}
                                <PluginCombo {...options} list={filterList(listX, ["PLUGIN_DATA"])} hidden={false} />
                            {:else}
                                <div class="statusnote">{TITLES[modeData]}</div>
                            {/if}
                        </div>
                    {:else}
                        <div class="noterow">
                            <div class="statusnote">{TITLES[modeAll]}</div>
                        </div>
                    {/if}
                {/each}
            </div>
        {/if}
    </div>
    {#if isMaintenanceMode}
        <div class="list">
            <div>
                <h3>Maintenance Commands</h3>
                <div class="maintenancerow">
                    <label for="">Delete All of </label>
                    <select bind:value={deleteTerm}>
                        {#each allTerms as term}
                            <option value={term}>{term}</option>
                        {/each}
                    </select>
                    <button
                        class="status"
                        on:click={(evt) => {
                            deleteAllItems(deleteTerm);
                        }}
                    >
                        🗑️
                    </button>
                </div>
            </div>
        </div>
    {/if}
    <div class="buttons">
        <label><span>Hide not applicable items</span><input type="checkbox" bind:checked={hideEven} /></label>
    </div>
    <div class="buttons">
        <label><span>Maintenance mode</span><input type="checkbox" bind:checked={isMaintenanceMode} /></label>
    </div>
</div>

<style>
    span.spacer {
        min-width: 1px;
        flex-grow: 1;
    }
    h3 {
        position: sticky;
        top: 0;
        background-color: var(--modal-background);
    }
    .labelrow {
        margin-left: 0.4em;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        border-top: 1px solid var(--background-modifier-border);
        padding: 4px;
        flex-wrap: wrap;
    }
    .filerow {
        margin-left: 1.25em;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        padding-right: 4px;
        flex-wrap: wrap;
    }
    .filerow.hideeven:has(.even),
    .labelrow.hideeven:has(.even) {
        display: none;
    }
    .noterow {
        min-height: 2em;
        display: flex;
    }
    button.status {
        flex-grow: 0;
        margin: 2px 4px;
        min-width: 3em;
        max-width: 4em;
    }
    .statusnote {
        display: flex;
        justify-content: flex-end;
        padding-right: var(--size-4-12);
        align-items: center;
        min-width: 10em;
        flex-grow: 1;
    }

    .title {
        color: var(--text-normal);
        font-size: var(--font-ui-medium);
        line-height: var(--line-height-tight);
        margin-right: auto;
    }
    .filetitle {
        color: var(--text-normal);
        font-size: var(--font-ui-medium);
        line-height: var(--line-height-tight);
        margin-right: auto;
    }
    .buttons {
        display: flex;
        flex-direction: row;
        justify-content: flex-end;
        margin-top: 8px;
        flex-wrap: wrap;
    }
    .buttons > button {
        margin-left: 4px;
        width: auto;
    }

    label {
        display: flex;
        justify-content: center;
        align-items: center;
    }
    label > span {
        margin-right: 0.25em;
    }
    :global(.is-mobile) .title,
    :global(.is-mobile) .filetitle {
        width: 100%;
    }

    .center {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 3em;
    }
    .maintenancerow {
        display: flex;
        justify-content: flex-end;
        align-items: center;
    }
    .maintenancerow label {
        margin-right: 0.5em;
        margin-left: 0.5em;
    }
</style>
