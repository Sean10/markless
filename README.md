> [!IMPORTANT]
> ## 📦 Archived
>
> **VS Code 1.135** (released 2026-08-26) ships a **built-in Markdown editor** with Typora-style WYSIWYG editing, as a third editor mode alongside the text editor and the preview. See the [1.135 release notes](https://code.visualstudio.com/updates/v1_135) and the [official walkthrough video](https://www.youtube.com/watch?v=7uyRMACA_pM).
>
> Since VS Code now provides this natively, **Markless is deprecated and no longer maintained.** It remains available on the Marketplace, but no further updates or fixes will be made.
>
> **To migrate:** open a `.md` file, pick **Markdown Editor** from the editor-type dropdown in the toolbar, then choose **Set default for .md** to make it the default.
>
> ### ⚠️ Not a drop-in replacement yet
>
> The built-in **Markdown Editor** is a separate webview implementation (`vscode.markdown.editor`), independent of both the text editor and the Markdown preview. As of VS Code 1.138 it does **not** support custom CSS — headings inherit `--vscode-editor-foreground` and render in a single color.
>
> Neither customization path reaches it:
>
> - **`markdown.styles`** — only wired into the preview webview, never injected into the editor webview
> - **`editor.tokenColorCustomizations`** — headings are not tokenized; only fenced code blocks receive theme token colors
>
> Markless keeps working precisely because it decorates the **native editor**, so `tokenColorCustomizations` applies. If per-level heading colors or other theming matter to you, stay on Markless, or use **Markdown Preview** (`markdown.styles` works there) until upstream support lands.
>
> ### Waiting on upstream
>
> Microsoft is [revisiting CSS/JS injection](https://github.com/microsoft/vscode/issues/328116#issuecomment-6078194577) for this editor. Tracking issues, all still open as of 2026-10-21:
>
> | Issue | Ask | Status |
> |---|---|---|
> | [#328116](https://github.com/microsoft/vscode/issues/328116) | Apply custom CSS / stylesheets | open · assigned to `@hediet` |
> | [#332732](https://github.com/microsoft/vscode/issues/332732) | Honor `markdown.preview.fontSize` | open |
> | [#328026](https://github.com/microsoft/vscode/issues/328026) | Configurable content width | open |
>
> `#328116` needs community upvotes to be moved into the backlog. If custom theming is your reason for using Markless, that is the issue to 👍.

<div align="center" id="top"><img src="assets/logo.png" align="center" alt="markless" width="425"></div>

<div align="center">

Inspired by Typora<sup>[diff](#differences)</sup>
</div>

Preview markdown inline and extend the capabilities through existing VS Code extensions.

<details>

<summary>Contents</summary>

- Features
    - [**Headers**](#headers)
    - [**URLs**](#urls)
    - [**Images**](#images)
      - [**Preview on hover**](#preview-on-hover)
      - [**Preview inline**](#preview-inline)
    - [**Inline code**](#inline-code)
    - [**LaTeX**](#latex)
      - [**Live preview**](#live-preview)
    - [**Emphasis**](#emphasis)
    - [**Blockquote**](#blockquote)
    - [**Horizontal rule**](#horizontal-rule)
    - [**HTML tags**](#html-tags)
    - [**List**](#list)
    - [**Task list**](#task-list)
    - [**Mermaid**](#mermaid)
    - [**Table**](#table)
    - [**Reveal source**](#reveal-source)
    - [**Performance**](#performance)
    - [**Vim bindings**](#vim-bindings)
    - [**Spec compliant**](#spec-compliant)
- [**Extension Settings**](#extension-settings)
- [**Known Issues**](#known-issues)
- [**Relevant extensions**](#relevant-extensions)
- [**Typora equivalents**](#typora-equivalents)
- [**Differences**](#differences)
</details>

<div id="features"> </div>

# Headers

![](assets/heading.jpg)

# **URLs**

![](assets/url.jpg)

# **Images**

(and gifs!)

## **Preview on hover**

![](assets/hover.jpg)

## **Preview inline**

![](assets/inline-image.gif)

# **Inline code**

![](assets/inline-code.jpg)

# **LaTeX**

![](assets/latex.jpg)

`$..$` for inline blocks and `$$..$$` for multiline blocks.

## **Live preview**

![](assets/preview.jpg)

# **Emphasis**

![](assets/emphasis.jpg)

# **Blockquote**

![](assets/quote.jpg)

# **Horizontal rule**

![](assets/horizontal-rule.jpg)

# **HTML tags**

![](assets/html.gif)
 
# **List**

![](assets/list.jpg)

# **Task list**

![](assets/task-list.jpg)

# **Mermaid**

![](assets/mermaid.jpg)

Use `mermaid` as the language specifier in the code block.

# **Table**

![](assets/table.jpg)

# **Reveal source**

The concealed elements near the cursor are auto-revealed.

![](assets/reveal-source.gif)

To show all concealed elements, use the toggle button on the top-right. Alternatively, use the provided <kbd>Ctrl+Shift+m</kbd> shortcut. To reveal only the current line, toggle with <kbd>Ctrl+Shift+space</kbd>.

# **Performance**

The extension intelligently parses only the visible text for large files and employs caching extensively. Entire rendering takes well [under 100ms](https://www.pubnub.com/blog/how-fast-is-realtime-human-perception-and-technology/).

# **Vim bindings**

The implementation uses the native editor instead of [Custom UI](https://code.visualstudio.com/api/extension-guides/custom-editors). All extensions should work as expected _including_ [Neo Vim](https://github.com/asvetliakov/vscode-neovim/).

# **Spec compliant**

The parser follows the Github Flavoured Markdown (thus Commonmark) spec. It prevents inconsistency with the formats exported with spec compliant renderers.

# **Extension Settings**

Look under _Markless_ section to selectively turn off the eye candies.

<details>

<summary>Add the following in settings.json for better rendering.</summary>

```json
"editor.tokenColorCustomizations": {
    "textMateRules": [
        {
            "scope": "markup.list",
            "settings": {
                "foreground": "#6c7500",
                },
        },
        {
            "scope": "markup.bold",
            "settings": {
                "fontStyle": "bold",
            },
        },
        {
            "scope": "markup.heading",
            "settings": {
                "fontStyle": "bold",
            },
        },
        {
            "scope": "markup.inline.raw",
            "settings": {
                "fontStyle": "bold",
                "foreground": "#707070",
            },
        },
        {
            "scope": "string.other.link.title.markdown",
            "settings": {
                "fontStyle": "underline",
            },
        },
    ],
},
```
</details>


# **Known Issues**

Bracket pair colorizers interfere with the rendering. If you use one, install the [patched version](https://github.com/tejasvi/rainbow-brackets-2) which excludes the markdown files.

-----------------------------------------------------------------------------------------------------------

# **Relevant extensions**

* [Keyboard Shortcuts, Tables and TOC](https://github.com/yzhang-gh/vscode-markdown)
* [Wikilinks, Backlinks, Tags](https://marketplace.visualstudio.com/items?itemName=foam.foam-vscode)
* [Image paste](https://marketplace.visualstudio.com/items?itemName=telesoho.vscode-markdown-paste-image)
* [Todo lists](https://marketplace.visualstudio.com/items?itemName=fabiospampinato.vscode-markdown-todo)
* [Snippets](https://marketplace.visualstudio.com/items?itemName=robole.markdown-snippets)
* [Linting](https://marketplace.visualstudio.com/items?itemName=starkwang.markdown)
* [Custom CSS](https://github.com/be5invis/vscode-custom-css#getting-started)
* [Vim bindings](https://github.com/asvetliakov/vscode-neovim/)
* [One of yours](https://code.visualstudio.com/api/get-started/your-first-extension)

# **Typora equivalents**

* [Markdown editor](https://github.com/zaaack/vscode-markdown-editor)
* [Mark Text](https://github.com/marktext/marktext)
* [Zettlr](https://github.com/Zettlr/Zettlr)
* [Noteworthy](https://github.com/benrbray/noteworthy)

---

# FAQ
## Q: How to make Images Preview always maximized
Set vscode settings `Workbench › Panel: Opens Maximized` as `always`.


# DEBUG
## Set workspace's setting `markless.debug` to `true`
Then `log.debug` will log to console.

# **Differences**

|  | Markless | Typora |
| -|-|-|
| Vim bindings | ☑ |  |
| Extensible | ☑ |  |
| Open source | ☑ |  |
| UI Polish | ▣ | ☑ |
| Advanced CSS |  | ☑ |
| iFrame embeds[*](https://github.com/microsoft/vscode/issues/85682) |  | ☑ |