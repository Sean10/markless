const vscode = require('vscode');
const log = require('loglevel');
const { state } = require('./state');

function enableHoverImage(context) {
    context.subscriptions.push(vscode.languages.registerHoverProvider('markdown', {
        provideHover: (document, position) => {
            const line = document.lineAt(position).text;
            // console.log("HHOOVVEERR: ", line);
            const regEx = /(!?)\[[^\]]*\]\((.+?)\)/g;
            let match;
            while ((match = regEx.exec(line))) {
                // console.log("HHOOVVEERR: match ", match);
                if (match.index - 1 <= position.character && position.character <= match.index + match[0].length) {
                    const range = new vscode.Range(position.line, match.index, position.line, match.index + match[0].length + 1);
                    const parsedUri = urlToUri(match[2]);
                    if (match[1].length == 1) {
                        return new vscode.Hover(new vscode.MarkdownString(`[![hoverPreview](${parsedUri})](${parsedUri})`), range);
                    } else {
                        return new vscode.Hover(new vscode.MarkdownString(`**[${match[2]}](${parsedUri})**`), range);
                    }
                }
            }
        }
    }));
}


const texToSvg = (() => {
    const { mathjax } = require('mathjax-full/js/mathjax.js');
    const { TeX } = require('mathjax-full/js/input/tex.js');
    const { SVG } = require('mathjax-full/js/output/svg.js');
    const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
    const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
    const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');
    const CSS = [
        'svg a{fill:blue;stroke:blue}',
        '[data-mml-node="merror"]>g{fill:red;stroke:red}',
        '[data-mml-node="merror"]>rect[data-background]{fill:yellow;stroke:none}',
        '[data-frame],[data-line]{stroke-width:70px;fill:none}',
        '.mjx-dashed{stroke-dasharray:140}',
        '.mjx-dotted{stroke-linecap:round;stroke-dasharray:0,140}',
        'use[data-c]{stroke-width:3px}'
    ].join('');
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const packages = { packages: AllPackages.sort().join(', ').split(/\s*,\s*/) };

    const tex = new TeX(packages);
    const svg = new SVG({ fontCache: 'local' });
    const html = mathjax.document('', { InputJax: tex, OutputJax: svg });

    return (texString, display, height) => {
        const node = html.convert(texString, { display: display });
        const attributes = node.children[0].attributes;
        if (height) {
            // console.log('height: ', parseFloat(attributes["width"]), height, parseFloat(attributes["height"]), parseFloat(attributes["width"]) * height / parseFloat(attributes["height"]))
            attributes["width"] = `${parseFloat(attributes["width"]) * height / parseFloat(attributes["height"])}px`;
            attributes["height"] = `${height}px`;
        }
        attributes.preserveAspectRatio = "xMinYMin meet";
        // console.log(node);
        let svgElement = adaptor.innerHTML(node);
        svgElement = svgElement.replace(/<defs>/, `<defs><style>${CSS}</style>`);
        return svgElement;
    }
})();

class DefaultMap extends Map {
    get(key) {
        if (!this.has(key)) {
            this.set(key, this.defaultMethod());
        }
        return super.get(key);
    }
    constructor(defaultMethod) {
        super();
        this.defaultMethod = defaultMethod;
    }
}

function memoize(func) {
    return (() => {
        const cache = new Map();
        return (...args) => {
            const key = args.toString();
            if (!cache.has(key)) {
                cache.set(key, func(...args));
            }
            return cache.get(key);
        };
    })();
}

/**
 * @param {string} url
 */
function urlToUri(url) {
    if (url.includes(":")) {
        if (url.match(/^[A-Z]:\\[^\\]/)) {
            return vscode.Uri.file(url);
        } else {
            return vscode.Uri.parse(url, true);
        }
    } else if (url.startsWith("/")) {
        return vscode.Uri.file(url);
    } else {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const cwd = workspaceFolders ? workspaceFolders[0].uri : vscode.Uri.file("/");
        return vscode.Uri.joinPath(cwd, url);
    }
}


function svgToUri(svg) {
    log.debug("svg:", svg);
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function htmlToSvg(height, width, html, css) {
    return `
    <svg width="${width}" height="${height}" style="overflow: visible;" xmlns="http://www.w3.org/2000/svg"><foreignObject class="node" x="0" y="0" width="100%" height="100%"><body xmlns="http://www.w3.org/1999/xhtml">
    <style>${css ? css : ""}</style>
    ${html}
    </body></foreignObject></svg>`
}

const parser = require('unified')()
    .use(require('remark-parse'))
    .use(require('remark-frontmatter').default, ['yaml', 'toml'])
    .use(require('remark-gfm'))
    .use(require('remark-math'))
    .parse;

const nodeToHtml = (() => {
    // Need
    // "hast-util-to-html": "^7.1.3",
    // "mdast-util-to-hast": "^10.2.0",
    // else https://stackoverflow.com/a/63719868/8211365
    const toHast = require('mdast-util-to-hast');
    const toHtml = require('hast-util-to-html');
    return (/** @type {import("unist").Node} */ node) => toHtml(toHast(node, {allowDangerousHtml: state.config.allowDangerousHtml}), {allowDangerousHtml: state.config.allowDangerousHtml});
})();

const path = require('path');

module.exports = { DefaultMap, memoize, urlToUri, svgToUri, htmlToSvg, parser, nodeToHtml, texToSvg, enableHoverImage, path };
