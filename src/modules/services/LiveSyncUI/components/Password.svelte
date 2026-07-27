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
<input type="checkbox" bind:checked={showPassword} />
