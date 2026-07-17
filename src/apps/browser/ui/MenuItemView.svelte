<script lang="ts">
    import type { MenuItem } from "../BrowserMenu";

    type Props = {
        item: MenuItem;
        closeMenu: () => void;
    };
    const { item = $bindable(), closeMenu }: Props = $props();
    function handleCommit(event: MouseEvent | KeyboardEvent) {
        event.preventDefault();
        try {
            if (item.handler) {
                item.handler?.();
            }
        } catch (ex) {
            console.error(ex);
        }
        closeMenu();
    }
    const icons = {
        checkmark: "✓",
    } as { [key: string]: string };
    function renderIcon(item: MenuItem) {
        if (item.icon && item.icon in icons) {
            return icons[item.icon] ?? item.icon;
        } else if (item.icon !== undefined) {
            return "";
        }
        return "";
    }
</script>

<li>
    <span class="icon">{renderIcon(item)}</span>
    <label for=""
        ><!-- svelte-ignore a11y_invalid_attribute -->
        <a onclick={handleCommit} onkeydown={handleCommit} role="button" tabindex="0" href="#">{item.title}</a></label
    >
</li>

<style>
    span.icon {
        display: inline-block;
        min-width: 1.5em;
        text-align: center;
    }
    li {
        list-style: none;
        padding: 0.5em 1em;
    }
</style>
