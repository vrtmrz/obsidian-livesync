<script lang="ts">
    import { translateIfAvailable as translate } from "@/common/translation";
    import { fireAndForget } from "octagonal-wheels/promises";

    type Props = {
        title: string;
        commit: () => Promise<void> | void;
        important?: boolean;
        destructive?: boolean;
        additionalClasses?: string;
        disabled?: boolean;
    };
    let { title, commit, additionalClasses, important, disabled = $bindable(), destructive }: Props = $props();
    const translatedTitle = $derived.by(() => translate(title));
    function onclick() {
        fireAndForget(async () => commit());
    }
</script>

<button
    class="button {additionalClasses} {important ? 'mod-cta' : ''} {destructive ? 'mod-destructive' : ''}"
    {onclick}
    {disabled}>{translatedTitle}</button
>
