<script lang="ts">
    import { translateIfAvailable as translate } from "@/common/translation";

    type Props = {
        value: string;
        name?: string;
        placeholder?: string;
        disabled?: boolean;
        required?: boolean;
    };
    let {
        value = $bindable(),
        name = "password",
        placeholder = "Enter your password",
        disabled = false,
        required = false,
    }: Props = $props();
    let showPassword = $state(false);
    const type = $derived.by(() => (showPassword ? "text" : "password"));
    const translatedPlaceholder = $derived.by(() => translate(placeholder));
    const toggleLabel = $derived.by(() => translate(showPassword ? "Hide password" : "Show password"));
</script>

<input
    {type}
    {name}
    placeholder={translatedPlaceholder}
    bind:value
    {disabled}
    {required}
    spellcheck="false"
    autocorrect="off"
    autocapitalize="off"
/>
<button
    type="button"
    class="sls-password-toggle"
    aria-label={toggleLabel}
    title={toggleLabel}
    aria-pressed={showPassword}
    {disabled}
    onclick={() => (showPassword = !showPassword)}
>
    {#if showPassword}
        <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
            <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
            <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
            <line x1="2" x2="22" y1="2" y2="22" />
        </svg>
    {:else}
        <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    {/if}
</button>

<style>
    .sls-password-toggle {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        padding: 4px;
        margin-left: 4px;
        background: transparent;
        border: none;
        box-shadow: none;
        color: var(--text-muted);
        cursor: pointer;
    }
    .sls-password-toggle:hover {
        color: var(--text-normal);
        background: var(--background-modifier-hover);
    }
</style>
