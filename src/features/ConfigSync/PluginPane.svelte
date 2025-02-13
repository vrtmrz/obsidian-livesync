<script lang="ts">
    import { onMount } from "svelte";
    import ObsidianLiveSyncPlugin from "../../main";
    import {
        ConfigSync,
        type IPluginDataExDisplay,
        pluginIsEnumerating,
        pluginList,
        pluginManifestStore,
        pluginV2Progress,
    } from "./CmdConfigSync.ts";
    import PluginCombo from "./PluginCombo.svelte";
    import { Menu, type PluginManifest } from "obsidian";
    import { unique } from "../../lib/src/common/utils";
    import {
        MODE_SELECTIVE,
        MODE_AUTOMATIC,
        MODE_PAUSED,
        type SYNC_MODE,
        MODE_SHINY,
    } from "../../lib/src/common/types";
    import { normalizePath } from "../../deps";
    import { HiddenFileSync } from "../HiddenFileSync/CmdHiddenFileSync.ts";
    import { LOG_LEVEL_NOTICE, Logger } from "octagonal-wheels/common/logger";
    export let plugin: ObsidianLiveSyncPlugin;

    $: hideNotApplicable = false;
    $: thisTerm = plugin.$$getDeviceAndVaultName();

    const addOn = plugin.getAddOn(ConfigSync.name) as ConfigSync;
    if (!addOn) {
        const msg =
            "AddOn Module (ConfigSync) has not been loaded. This is very unexpected situation. Please report this issue.";
        Logger(msg, LOG_LEVEL_NOTICE);
        throw new Error(msg);
    }
    const addOnHiddenFileSync = plugin.getAddOn(HiddenFileSync.name) as HiddenFileSync;
    if (!addOnHiddenFileSync) {
        const msg =
            "AddOn Module (HiddenFileSync) has not been loaded. This is very unexpected situation. Please report this issue.";
        Logger(msg, LOG_LEVEL_NOTICE);
        throw new Error(msg);
    }

    let list: IPluginDataExDisplay[] = [];

    let selectNewestPulse = 0;
    let selectNewestStyle = 0;
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

    function filterList(list: IPluginDataExDisplay[], categories: string[]) {
        const w = list.filter((e) => categories.indexOf(e.category) !== -1);
        return w.sort((a, b) => `${a.category}-${a.name}`.localeCompare(`${b.category}-${b.name}`));
    }

    function groupBy(items: IPluginDataExDisplay[], key: string) {
        let ret = {} as Record<string, IPluginDataExDisplay[]>;
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
        await plugin.$$replicate(true);
    }
    function selectAllNewest(selectMode: boolean) {
        selectNewestPulse++;
        selectNewestStyle = selectMode ? 1 : 2;
    }
    function resetSelectNewest() {
        selectNewestPulse++;
        selectNewestStyle = 3;
    }
    function applyAll() {
        applyAllPluse++;
    }
    async function applyData(data: IPluginDataExDisplay): Promise<boolean> {
        return await addOn.applyData(data);
    }
    async function compareData(
        docA: IPluginDataExDisplay,
        docB: IPluginDataExDisplay,
        compareEach = false
    ): Promise<boolean> {
        return await addOn.compareUsingDisplayData(docA, docB, compareEach);
    }
    async function deleteData(data: IPluginDataExDisplay): Promise<boolean> {
        return await addOn.deleteData(data);
    }
    function askMode(evt: MouseEvent, title: string, key: string) {
        const menu = new Menu();
        menu.addItem((item) => item.setTitle(title).setIsLabel(true));
        menu.addSeparator();
        const prevMode = automaticList.get(key) ?? MODE_SELECTIVE;
        for (const mode of [MODE_SELECTIVE, MODE_AUTOMATIC, MODE_PAUSED, MODE_SHINY]) {
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
        addOnHiddenFileSync.initialiseInternalFileSync(direction, true, files);
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
        selectNewestStyle,
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
    const ICON_EMOJI_FLAGGED = `🚩`;

    const ICONS: { [key: number]: string } = {
        [MODE_SELECTIVE]: ICON_EMOJI_SELECTIVE,
        [MODE_PAUSED]: ICON_EMOJI_PAUSED,
        [MODE_AUTOMATIC]: ICON_EMOJI_AUTOMATIC,
        [MODE_SHINY]: ICON_EMOJI_FLAGGED,
    };
    const TITLES: { [key: number]: string } = {
        [MODE_SELECTIVE]: "Selective",
        [MODE_PAUSED]: "Ignore",
        [MODE_AUTOMATIC]: "Automatic",
        [MODE_SHINY]: "Flagged Selective",
    };
    const PREFIX_PLUGIN_ALL = "PLUGIN_ALL";
    const PREFIX_PLUGIN_DATA = "PLUGIN_DATA";
    const PREFIX_PLUGIN_MAIN = "PLUGIN_MAIN";
    const PREFIX_PLUGIN_ETC = "PLUGIN_ETC";
    function setMode(key: string, mode: SYNC_MODE) {
        if (key.startsWith(PREFIX_PLUGIN_ALL + "/")) {
            setMode(PREFIX_PLUGIN_DATA + key.substring(PREFIX_PLUGIN_ALL.length), mode);
            setMode(PREFIX_PLUGIN_MAIN + key.substring(PREFIX_PLUGIN_ALL.length), mode);
            return;
        }
        const files = unique(
            list
                .filter((e) => `${e.category}/${e.name}` == key)
                .map((e) => e.files)
                .flat()
                .map((e) => e.filename)
        );
        if (mode == MODE_SELECTIVE) {
            automaticList.delete(key);
            delete plugin.settings.pluginSyncExtendedSetting[key];
            automaticListDisp = automaticList;
        } else {
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
        }
        plugin.$$saveSettingData();
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

    function computeDisplayKeys(list: IPluginDataExDisplay[]) {
        const extraKeys = Object.keys(plugin.settings.pluginSyncExtendedSetting);
        return [
            ...list,
            ...extraKeys
                .map((e) => `${e}///`.split("/"))
                .filter((e) => e[0] && e[1])
                .map((e) => ({ category: e[0], name: e[1], displayName: e[1] })),
        ]
            .sort((a, b) => (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name))
            .reduce(
                (p, c) => ({
                    ...p,
                    [c.category]: unique(
                        c.category in p ? [...p[c.category], c.displayName ?? c.name] : [c.displayName ?? c.name]
                    ),
                }),
                {} as Record<string, string[]>
            );
    }
    $: {
        displayKeys = computeDisplayKeys(list);
    }

    let deleteTerm = "";

    async function deleteAllItems(term: string) {
        const deleteItems = list.filter((e) => e.term == term);
        for (const item of deleteItems) {
            await deleteData(item);
        }
        addOn.reloadPluginList(true);
    }

    let nameMap = new Map<string, string>();
    function updateNameMap(e: Map<string, PluginManifest>) {
        const items = [...e.entries()].map(([k, v]) => [k.split("/").slice(-2).join("/"), v.name] as [string, string]);
        const newMap = new Map(items);
        if (newMap.size == nameMap.size) {
            let diff = false;
            for (const [k, v] of newMap) {
                if (nameMap.get(k) != v) {
                    diff = true;
                    break;
                }
            }
            if (!diff) {
                return;
            }
        }
        nameMap = newMap;
    }
    $: updateNameMap($pluginManifestStore);

    let displayEntries = [] as [string, string][];
    $: {
        displayEntries = Object.entries(displays).filter(([key, _]) => key in displayKeys);
    }

    let pluginEntries = [] as [string, IPluginDataExDisplay[]][];
    $: {
        pluginEntries = groupBy(filterList(list, ["PLUGIN_MAIN", "PLUGIN_DATA", "PLUGIN_ETC"]), "name");
    }
    let useSyncPluginEtc = plugin.settings.usePluginEtc;
</script>

<div class="buttonsWrap">
    <div class="buttons">
        <button on:click={() => scanAgain()}>Scan changes</button>
        <button on:click={() => replicate()}>Sync once</button>
        <button on:click={() => requestUpdate()}>Refresh</button>
        {#if isMaintenanceMode}
            <button on:click={() => requestReload()}>Reload</button>
        {/if}
    </div>
    <div class="buttons">
        <button on:click={() => selectAllNewest(true)}>Select All Shiny</button>
        <button on:click={() => selectAllNewest(false)}>{ICON_EMOJI_FLAGGED} Select Flagged Shiny</button>
        <button on:click={() => resetSelectNewest()}>Deselect all</button>
        <button on:click={() => applyAll()} class="mod-cta">Apply All Selected</button>
    </div>
</div>
<div class="loading">
    {#if loading || $pluginV2Progress !== 0}
        <span>Updating list...{$pluginV2Progress == 0 ? "" : ` (${$pluginV2Progress})`}</span>
    {/if}
</div>
<div class="list">
    {#if list.length == 0}
        <div class="center">No Items.</div>
    {:else}
        {#each displayEntries as [key, label]}
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
                            <span class="name">{(key == "THEME" && nameMap.get(`themes/${name}`)) || name}</span>
                        </div>
                        <div class="body">
                            {#if mode == MODE_SELECTIVE || mode == MODE_SHINY}
                                <PluginCombo
                                    {...options}
                                    isFlagged={mode == MODE_SHINY}
                                    list={list.filter((e) => e.category == key && e.name == name)}
                                    hidden={false}
                                />
                            {:else}
                                <div class="statusnote">{TITLES[mode]}</div>
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        {/each}
        <div>
            <h3>Plugins</h3>
            {#each pluginEntries as [name, listX]}
                {@const bindKeyAll = `${PREFIX_PLUGIN_ALL}/${name}`}
                {@const modeAll = automaticListDisp.get(bindKeyAll) ?? MODE_SELECTIVE}
                {@const bindKeyMain = `${PREFIX_PLUGIN_MAIN}/${name}`}
                {@const modeMain = automaticListDisp.get(bindKeyMain) ?? MODE_SELECTIVE}
                {@const bindKeyData = `${PREFIX_PLUGIN_DATA}/${name}`}
                {@const modeData = automaticListDisp.get(bindKeyData) ?? MODE_SELECTIVE}
                {@const bindKeyETC = `${PREFIX_PLUGIN_ETC}/${name}`}
                {@const modeEtc = automaticListDisp.get(bindKeyETC) ?? MODE_SELECTIVE}
                <div class="labelrow {hideEven ? 'hideeven' : ''}">
                    <div class="title">
                        <button
                            class="status"
                            on:click={(evt) => askMode(evt, `${PREFIX_PLUGIN_ALL}/${name}`, bindKeyAll)}
                        >
                            {getIcon(modeAll)}
                        </button>
                        <span class="name">{nameMap.get(`plugins/${name}`) || name}</span>
                    </div>
                    <div class="body">
                        {#if modeAll == MODE_SELECTIVE || modeAll == MODE_SHINY}
                            <PluginCombo {...options} isFlagged={modeAll == MODE_SHINY} list={listX} hidden={true} />
                        {/if}
                    </div>
                </div>
                {#if modeAll == MODE_SELECTIVE || modeAll == MODE_SHINY}
                    <div class="filerow {hideEven ? 'hideeven' : ''}">
                        <div class="filetitle">
                            <button
                                class="status"
                                on:click={(evt) => askMode(evt, `${PREFIX_PLUGIN_MAIN}/${name}/MAIN`, bindKeyMain)}
                            >
                                {getIcon(modeMain)}
                            </button>
                            <span class="name">MAIN</span>
                        </div>
                        <div class="body">
                            {#if modeMain == MODE_SELECTIVE || modeMain == MODE_SHINY}
                                <PluginCombo
                                    {...options}
                                    isFlagged={modeMain == MODE_SHINY}
                                    list={filterList(listX, ["PLUGIN_MAIN"])}
                                    hidden={false}
                                />
                            {:else}
                                <div class="statusnote">{TITLES[modeMain]}</div>
                            {/if}
                        </div>
                    </div>
                    <div class="filerow {hideEven ? 'hideeven' : ''}">
                        <div class="filetitle">
                            <button
                                class="status"
                                on:click={(evt) => askMode(evt, `${PREFIX_PLUGIN_DATA}/${name}`, bindKeyData)}
                            >
                                {getIcon(modeData)}
                            </button>
                            <span class="name">DATA</span>
                        </div>
                        <div class="body">
                            {#if modeData == MODE_SELECTIVE || modeData == MODE_SHINY}
                                <PluginCombo
                                    {...options}
                                    isFlagged={modeData == MODE_SHINY}
                                    list={filterList(listX, ["PLUGIN_DATA"])}
                                    hidden={false}
                                />
                            {:else}
                                <div class="statusnote">{TITLES[modeData]}</div>
                            {/if}
                        </div>
                    </div>
                    {#if useSyncPluginEtc}
                        <div class="filerow {hideEven ? 'hideeven' : ''}">
                            <div class="filetitle">
                                <button
                                    class="status"
                                    on:click={(evt) => askMode(evt, `${PREFIX_PLUGIN_ETC}/${name}`, bindKeyETC)}
                                >
                                    {getIcon(modeEtc)}
                                </button>
                                <span class="name">Other files</span>
                            </div>
                            <div class="body">
                                {#if modeEtc == MODE_SELECTIVE || modeEtc == MODE_SHINY}
                                    <PluginCombo
                                        {...options}
                                        isFlagged={modeEtc == MODE_SHINY}
                                        list={filterList(listX, ["PLUGIN_ETC"])}
                                        hidden={false}
                                    />
                                {:else}
                                    <div class="statusnote">{TITLES[modeEtc]}</div>
                                {/if}
                            </div>
                        </div>
                    {/if}
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
    <div class="buttons">
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

<style>
    .buttonsWrap {
        padding-bottom: 4px;
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

    .filerow.hideeven:has(:global(.even)),
    .labelrow.hideeven:has(:global(.even)) {
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
    .list {
        overflow-y: auto;
    }
    .title {
        color: var(--text-normal);
        font-size: var(--font-ui-medium);
        line-height: var(--line-height-tight);
        margin-right: auto;
    }
    .body {
        /* margin-left: 0.4em; */
        margin-left: auto;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        /* flex-wrap: wrap; */
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

    .loading {
        transition: height 0.25s ease-in-out;
        transition-delay: 4ms;
        overflow-y: hidden;
        flex-shrink: 0;
        display: flex;
        justify-content: flex-start;
        align-items: center;
    }
    .loading:empty {
        height: 0px;
        transition: height 0.25s ease-in-out;
        transition-delay: 1s;
    }
    .loading:not(:empty) {
        height: 2em;
        transition: height 0.25s ease-in-out;
        transition-delay: 0;
    }
</style>
