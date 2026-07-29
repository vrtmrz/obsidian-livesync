<script lang="ts">
    import type { DialogHostProps } from "@vrtmrz/livesync-commonlib/compat/services/implements/base/SvelteDialog";
    import { type DialogSvelteComponentBaseProps } from "./svelteDialog";
    // type Props = DialogSvelteComponentBaseProps & {
    //     /**
    //      * The Svelte component to mount inside the dialog host
    //      */
    //     mountComponent: ComponentHasResult<any>;
    //     /**
    //      * Callback function to setup the dialog context
    //      * @param props
    //      */
    //     onSetupContext?(props: DialogSvelteComponentBaseProps): void;
    // };
    const props: DialogHostProps = $props();
    const contextProps = {
        setTitle: (title: string) => props.setTitle(title),
        closeDialog: () => props.closeDialog(),
        setResult: (result: any) => props.setResult(result),
        getInitialData: () => props.getInitialData?.(),
    } satisfies DialogSvelteComponentBaseProps<any, any>;

    // Context must be established during component initialisation. The callbacks retain live access to the host props.
    const setupContext = () => props.onSetupContext?.(contextProps);
    setupContext();

    /**
     * Wrapper around setResult to also close the dialog
     * @param result
     */
    const setResultWrapper = (result: any) => {
        props.setResult(result);
        props.closeDialog();
    };

    const Component = $derived(props.mountComponent);
    let thisElement: HTMLElement;
</script>

<div class="dialog-host" bind:this={thisElement}>
    <Component setResult={setResultWrapper} getInitialData={props.getInitialData}></Component>
</div>

<style>
    :global(body.is-mobile .livesync-svelte-dialog-container) {
        box-sizing: border-box;
        padding-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
        padding-right: var(--safe-area-inset-right, env(safe-area-inset-right, 0px));
        padding-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
        padding-left: var(--safe-area-inset-left, env(safe-area-inset-left, 0px));
    }

    :global(body.is-mobile .livesync-svelte-dialog-container .modal) {
        max-height: 100%;
    }

    :global(body.is-mobile .livesync-svelte-dialog-container .dialog-host > .button-group) {
        background: var(--modal-background, var(--background-primary));
        bottom: 0;
        padding-bottom: 1px;
        position: sticky;
        z-index: 1;
    }

    .dialog-host {
        padding: 20px;
        gap: 0.5em;
        display: flex;
        flex-direction: column;
        padding-bottom: var(--keyboard-height, 0px);
        user-select: text;
        -webkit-user-select: text;
    }

    .dialog-host :global(button) {
        margin-left: 10px;
    }

    .dialog-host :global(.button-group) {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 20px;
    }

    .dialog-host :global(.row) {
        display: flex;
        flex-direction: row;
        justify-items: center;
        align-items: center;
        flex-wrap: wrap;
    }

    .dialog-host :global(.row > input[type="text"]),
    .dialog-host :global(.row > input[type="password"]),
    .dialog-host :global(.row > textarea),
    .dialog-host :global(.row > select) {
        flex: 1;
        margin-left: 10px;
        min-width: 10em;
    }
    .dialog-host :global(.row > input[type="password"]) {
        -webkit-text-security: disc;
    }

    .dialog-host :global(.row > input[type="checkbox"]) {
        margin-left: 10px;
        margin-right: 10px;
    }

    .dialog-host :global(label > span) {
        display: block;
        width: 8em;
    }

    .dialog-host :global(.note),
    .dialog-host :global(.note-important),
    .dialog-host :global(.note-error) {
        padding: 10px;
        margin-top: 4px;
        margin-bottom: 0.5lh;
        border-left: 4px solid;
    }

    .dialog-host :global(.note) {
        background-color: var(--interactive-hover);
        border-left-color: var(--interactive-accent);
    }
    .dialog-host :global(.note-important) {
        background-color: var(--interactive-hover);
        border-left-color: var(--text-warning);
    }
    .dialog-host :global(.note-error) {
        background-color: var(--interactive-hover);
        border-left-color: var(--text-error);
    }
    .dialog-host :global(hr) {
        margin: 0.7lh 0;
    }
    .dialog-host :global(details) {
        gap: 0.5em;
        padding-left: 0.5em;
        border-left: 2px solid var(--interactive-accent);
    }
    .dialog-host :global(summary::marker) {
        display: none;
        content: "";
    }

    .dialog-host :global(summary) {
        border-left: 4px solid var(--interactive-accent);
        padding-left: 0.5em;
        cursor: pointer;
        outline: none;
    }
    .dialog-host :global(details > summary::after) {
        content: "⏷";
        float: right;
        margin-right: 0.5em;
    }
    .dialog-host :global(details[open] > summary::after) {
        content: "⏶";
        float: right;
        margin-right: 0.5em;
    }

    .dialog-host :global(input:invalid),
    .dialog-host :global(textarea:invalid) {
        border-color: var(--background-modifier-error);
    }
    .dialog-host :global(.sub-section) {
        margin-left: 1em;
        display: flex;
        flex-direction: column;
        gap: 0.5em;
    }

    .dialog-host :global(.row > input[type="text"]:disabled),
    .dialog-host :global(.row > input[type="password"]:disabled),
    .dialog-host :global(.row > textarea:disabled),
    .dialog-host :global(.row > select:disabled) {
        background-color: var(--background-secondary);
    }
</style>
