import MarkdownIt from "markdown-it";

const markdownRenderer = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: true,
});

const defaultLinkOpenRenderer =
    markdownRenderer.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

markdownRenderer.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener noreferrer");
    return defaultLinkOpenRenderer(tokens, idx, options, env, self);
};

export function renderMessageMarkdown(message: string): string {
    return markdownRenderer.render(message);
}

export function renderMessageMarkdownInto(container: HTMLElement, message: string): void {
    const DOMParserConstructor = container.ownerDocument.defaultView?.DOMParser;
    if (!DOMParserConstructor) {
        container.textContent = message;
        return;
    }
    const parsed = new DOMParserConstructor().parseFromString(renderMessageMarkdown(message), "text/html");
    container.replaceChildren(...Array.from(parsed.body.childNodes));
}
