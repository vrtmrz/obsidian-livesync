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
