const { state } = require('./state');
const { parser, urlToUri, DefaultMap } = require('./util');
const vscode = require('vscode')
const log = require('loglevel')

const addInlineImages = (() => {
    class ImageComment {
        constructor(url) {
            this.mode = vscode.CommentMode.Preview;
            this.author = { name: "" };
            // console.log("Image comment: ", [url]);
            const parsedUri = urlToUri(url);
            // console.log("Image comment:", parsedUri);
            this.body = new vscode.MarkdownString(`[![inlinePreview](${parsedUri})](${parsedUri})`);
        }
    }
    const imageThreadMap = new DefaultMap(() => new Map());
    return () => {
        const documentUri = state.activeEditor.document.uri;
        const documentUriString = documentUri.toString();
        const lastImageThreadMap = imageThreadMap.get(documentUriString);
        const newImageThreadMap = new Map();

        for (const [matchRange, url, alt] of state.imageList) {
            const key = [documentUriString, matchRange, url].toString();
            // console.log("Image comment key: ", key);

            if (lastImageThreadMap.has(key)) {
                // console.log("Image comment has key: ", key);
                newImageThreadMap.set(key, lastImageThreadMap.get(key));
                lastImageThreadMap.delete(key);
            } else {
                const thread = state.commentController.createCommentThread(documentUri, matchRange, [new ImageComment(url)]);
                thread.canReply = false;
                if (state.autoImagePreview) {
                    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
                }
                thread.label = alt;
                newImageThreadMap.set(key, thread);
            }
        }
        state.imageList = [];
        for (let thread of lastImageThreadMap.values()) {
            thread.dispose();
        }
        imageThreadMap.set(documentUriString, newImageThreadMap);
    };
})();

function posToRange(start, end) {
    const offsetToPos = state.activeEditor.document.positionAt;
    const rangeStart = offsetToPos(start + state.offset);
    const rangeEnd = offsetToPos(end + state.offset);
    const rangeSerializer = rangeStart.line+":"+rangeStart.character + "-" + rangeEnd.line + ":" + rangeEnd.character;
    if (state.rangeMap.hasOwnProperty(rangeSerializer)) {
        return state.rangeMap[rangeSerializer];
    }
    state.rangeMap[rangeSerializer] = new vscode.Range(rangeStart, rangeEnd);
    return state.rangeMap[rangeSerializer];
}

function addDecoration(decoration, startOffset, endOffset) {
    let range = posToRange(startOffset, endOffset);
    state.decorationRanges.get(decoration).push(range);
}

function updateSelectionToLine() {
    log.debug("update SelectionToLine", state.selection, state.selection.start.line);
    let line_start = state.activeEditor.document.lineAt(state.selection.start);
    let line_end = state.activeEditor.document.lineAt(state.selection.end);
    log.debug("line_start: ", line_start, "line_end: ", line_end);
    let start = line_start.range.start;
    let end = line_end.range.end;
    state.selection = new vscode.Selection(start, end);
}

function setDecorations() {
    for (let [decoration, ranges] of state.decorationRanges) {
        // console.log("decoration RANGES", [decoration, ranges]);
        if (state.config.cursorLineDisables) {
            updateSelectionToLine();
        }

        if (state.config.cursorDisables) {
            ranges = ranges.filter((r) => !state.selection.intersection(r));
        }
        state.activeEditor.setDecorations(decoration, ranges);
        if (ranges.length == 0) {
            state.decorationRanges.delete(decoration); // Unused decoration. Still exist in memoized decoration provider
        }
    }
    addInlineImages();
}

async function visitNodes(node) {
    const stack = [[node, 0]];
    while (stack.length) {
        let [curNode, listLevel] = stack.pop()
        const dec = state.types.get(curNode.type);
        const position = curNode.position;
        if (dec) {
            await dec(position.start.offset, position.end.offset, curNode, listLevel);
            if (curNode.type == "listItem") {
                listLevel += 1;
            }
        }
        if (curNode.children) {
            stack.push(...curNode.children.map(c => [c, listLevel]));
        }
        if (curNode.type == "list" && curNode.children && curNode.ordered) {
            curNode.children = curNode.children.map((item) => {
                item['isOrdered'] = true;
                return item;
            });
            // console.log("visit Node: ", JSON.stringify(curNode.children));
        } else if (curNode.type == "heading" && curNode.children) {
            curNode.children = curNode.children.map((item) => {
                item['headingDepth'] = curNode.depth;
                return item;
            });
        }
    }
}

function normalizeList() {
    let prefix = "";

    const regExPattern = "^( {2,})(\\*|\\d+(?:\\.|\\))|-|\\+) .";
    const match = new RegExp(regExPattern, "m").exec(state.text);
    if (match) {
        let spacesPerLevel = 4;
        const nextMatch = new RegExp(regExPattern.replace("2", String(match[1].length + 2)), "m").exec(state.text);
        if (nextMatch) {
            spacesPerLevel = nextMatch[1].length - match[1].length;
        }
        const maxLevel = Math.floor(match[1].length / spacesPerLevel);
        const listItem = match[2].length > 1 ? "1. a\n" : "* a\n";
        for (let level = 0; level < maxLevel; ++level) {
            prefix += " ".repeat(spacesPerLevel * level) + listItem;
        }
        prefix += '\n';
    }

    const codeMatch = /^ *[`~]{3,}\n/m.exec(state.text);
    if (codeMatch && state.text[codeMatch.index + 4] == '\n') {
        prefix = codeMatch[0];
    }

    if (prefix && state.offset >= prefix.length) {
        state.offset -= prefix.length;
        state.text = prefix + state.text;
    }
}


// let rejectRender = ()=>{};
/**
 * @param {vscode.Range} [range]
 */
function constructDecorations(range) {
    const activeEditor = state.activeEditor;
    state.text = activeEditor.document.getText(range);
    if (range) {
        state.offset = activeEditor.document.offsetAt(range.start);
        normalizeList();
    } else {
        state.offset = 0;
    }
    const node = parser(state.text);
    // rejectRender();
    // new Promise((resolve, reject) => {
    //     rejectRender = reject;
    //     resolve(visitNodes(node));
    // }).then(setDecorations).catch(() => {});
    visitNodes(node).then(setDecorations);
}

function updateLogLevel() {
    log.debug("set log level to debug: ", state.config.debug);
    if (state.config.debug) {
		log.setLevel("debug");
        log.debug("set log level to debug.")
	} else {
		log.setLevel("silent");
	}
}

function updateDecorations() {
    // console.log("updateDecorations");
    for (let decoration of state.decorationRanges.keys()) {
        state.decorationRanges.set(decoration, []); // Reduce failed lookups instead of .clear()
    }
    if (state.activeEditor.document.lineCount > 500) {
        for (let range of state.activeEditor.visibleRanges) {
            range = new vscode.Range(Math.max(range.start.line - 200, 0), 0, range.end.line + 200, 0);
            constructDecorations(range);
        }
    } else {
        constructDecorations();
    }
    // console.log("updateDecorationsEnd");
}

let timeout;
function triggerUpdateDecorations() {
    if (!state.enabled) return;
    // console.log("triggerUpdateDecorations");
    if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
    }
    timeout = setTimeout(updateDecorations, 10);
}

module.exports = { triggerUpdateDecorations, addDecoration, posToRange, updateLogLevel }