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
    👁️
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
        line-height: 1;
        cursor: pointer;
    }
    .sls-password-toggle:hover {
        background: var(--background-modifier-hover);
    }
</style>
