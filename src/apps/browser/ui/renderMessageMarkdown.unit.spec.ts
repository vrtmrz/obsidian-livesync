import { describe, expect, it } from "vitest";

import { renderMessageMarkdown } from "./renderMessageMarkdown";

describe("renderMessageMarkdown", () => {
    it("renders basic markdown features used by browser dialogues", () => {
        const html = renderMessageMarkdown("# Title\n\n| left | right |\n| --- | --- |\n| a | b |\n");

        expect(html).toContain("<h1>Title</h1>");
        expect(html).toContain("<table>");
        expect(html).toContain("<td>a</td>");
    });

    it("escapes inline HTML instead of rendering it", () => {
        const html = renderMessageMarkdown("Before<script>alert('xss')</script>After");

        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;alert('xss')&lt;/script&gt;");
    });

    it("opens Markdown links safely in a new tab", () => {
        const html = renderMessageMarkdown("[docs](https://example.com)");

        expect(html).toContain('target="_blank"');
        expect(html).toContain('rel="noopener noreferrer"');
    });
});
