<script lang="ts">
    import { translateIfAvailable as translate } from "@/common/translation";

    type SignalWord = "danger" | "warning" | "caution" | "notice";

    type Props = {
        title?: string;
        message?: string;
        children?: () => any;
        cssClass?: string;
        warning?: boolean;
        caution?: boolean;
        error?: boolean;
        notice?: boolean;
        info?: boolean;
        signalWord?: string | false;
        visible?: boolean;
    };
    const {
        title,
        message,
        children,
        cssClass,
        warning: isWarning,
        caution: isCaution,
        error: isError,
        notice: isNotice,
        info: isInfo = true,
        signalWord,
        visible,
    }: Props = $props();
    const derivedCssClass = $derived.by(() => {
        if (isError) {
            return "note-error sls-info-note sls-info-note-danger";
        } else if (isWarning) {
            return "note-important sls-info-note sls-info-note-warning";
        } else if (isCaution) {
            return "note-important sls-info-note sls-info-note-caution";
        } else if (isNotice) {
            return "note sls-info-note sls-info-note-notice";
        } else if (isInfo) {
            return "note sls-info-note";
        } else {
            return "sls-info-note";
        }
    });

    const signalWordKind = $derived.by((): SignalWord | undefined => {
        if (isError) return "danger";
        if (isWarning) return "warning";
        if (isCaution) return "caution";
        if (isNotice) return "notice";
        return undefined;
    });
    const defaultSignalWord = $derived.by(() => {
        switch (signalWordKind) {
            case "danger":
                return "Ui.Common.Signal.Danger";
            case "warning":
                return "Ui.Common.Signal.Warning";
            case "caution":
                return "Ui.Common.Signal.Caution";
            case "notice":
                return "Ui.Common.Signal.Notice";
            default:
                return "";
        }
    });
    const signalWordText = $derived.by(() => {
        if (signalWord === false) return "";
        return signalWord ? translate(signalWord) : defaultSignalWord ? translate(defaultSignalWord) : "";
    });
    const signalWordCssKind = $derived.by(() => signalWordKind ?? "custom");
    const translatedTitle = $derived.by(() => (title ? translate(title) : ""));
    const translatedMessage = $derived.by(() => (message ? translate(message) : ""));
</script>

{#if visible === undefined || visible === true}
    <div class={(cssClass ?? "") + " " + derivedCssClass}>
        {#if signalWordText}
            <div class="sls-signal-word sls-signal-word-{signalWordCssKind}">{signalWordText}</div>
        {/if}
        {#if translatedTitle}<h3>{translatedTitle}</h3>{/if}
        {#if translatedMessage}<p>{translatedMessage}</p>{/if}
        {@render children?.()}
    </div>
{/if}
