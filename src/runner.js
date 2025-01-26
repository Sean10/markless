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
        const editorState = state.getCurrentEditorState();
        if (!editorState) return;

        const documentUri = editorState.editor.document.uri;
        const documentUriString = documentUri.toString();
        const lastImageThreadMap = imageThreadMap.get(documentUriString);
        const newImageThreadMap = new Map();

        for (const [matchRange, url, alt] of editorState.imageList) {
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
        editorState.imageList = [];
        for (let thread of lastImageThreadMap.values()) {
            thread.dispose();
        }
        imageThreadMap.set(documentUriString, newImageThreadMap);
    };
})();

function posToRange(start, end) {
    const editorState = state.getCurrentEditorState();
    if (!editorState) return null;

    const offsetToPos = editorState.editor.document.positionAt;
    const rangeStart = offsetToPos(start + editorState.offset);
    const rangeEnd = offsetToPos(end + editorState.offset);
    const rangeSerializer = rangeStart.line+":"+rangeStart.character + "-" + rangeEnd.line + ":" + rangeEnd.character;

    if (state.rangeMap.has(rangeSerializer)) {
        return state.rangeMap.get(rangeSerializer);
    }
    const range = new vscode.Range(rangeStart, rangeEnd);
    state.rangeMap.set(rangeSerializer, range);
    return range;
}

function addDecoration(decoration, startOffset, endOffset) {
    const editorState = state.getCurrentEditorState();
    if (!editorState) return;

    let range = posToRange(startOffset, endOffset);
    if (!range) return;

    if (!editorState.decorationRanges.has(decoration)) {
        editorState.decorationRanges.set(decoration, []);
    }
    editorState.decorationRanges.get(decoration).push(range);
}

function updateSelectionToLine() {
    const editorState = state.getCurrentEditorState();
    if (!editorState) return;

    log.debug("update SelectionToLine", editorState.selection, editorState.selection.start.line);
    let line_start = editorState.editor.document.lineAt(editorState.selection.start);
    let line_end = editorState.editor.document.lineAt(editorState.selection.end);
    log.debug("line_start: ", line_start, "line_end: ", line_end);
    let start = line_start.range.start;
    let end = line_end.range.end;
    editorState.selection = new vscode.Selection(start, end);
}

function setDecorations() {
    const editorState = state.getCurrentEditorState();
    if (!editorState) return;

    for (let [decoration, ranges] of editorState.decorationRanges) {
        // console.log("decoration RANGES", [decoration, ranges]);
        if (state.config.cursorLineDisables) {
            updateSelectionToLine();
        }

        if (state.config.cursorDisables) {
            ranges = ranges.filter((r) => !editorState.selection.intersection(r));
        }
        editorState.editor.setDecorations(decoration, ranges);
        if (ranges.length == 0) {
            editorState.decorationRanges.delete(decoration); // Unused decoration. Still exist in memoized decoration provider
        }
    }
    addInlineImages();
}

async function visitNodes(node) {
    const editorState = state.getCurrentEditorState();
    if (!editorState) return;

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
    const editorState = state.getCurrentEditorState();
    if (!editorState) return;

    let prefix = "";
    const text = editorState.text;

    const regExPattern = "^( {2,})(\\*|\\d+(?:\\.|\\))|-|\\+) .";
    const match = new RegExp(regExPattern, "m").exec(text);
    if (match) {
        let spacesPerLevel = 4;
        const nextMatch = new RegExp(regExPattern.replace("2", String(match[1].length + 2)), "m").exec(text);
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

    const codeMatch = /^ *[`~]{3,}\n/m.exec(text);
    if (codeMatch && text[codeMatch.index + 4] == '\n') {
        prefix = codeMatch[0];
    }

    if (prefix && editorState.offset >= prefix.length) {
        editorState.offset -= prefix.length;
        editorState.text = prefix + text;
    }
}


// let rejectRender = ()=>{};
/**
 * @param {vscode.Range} [range]
 */
function constructDecorations(range) {
    const editorState = state.getCurrentEditorState();
    if (!editorState) return;

    editorState.text = editorState.editor.document.getText(range);
    if (range) {
        editorState.offset = editorState.editor.document.offsetAt(range.start);
        normalizeList();
    } else {
        editorState.offset = 0;
    }
    const node = parser(editorState.text);
    // rejectRender();
    // new Promise((resolve, reject) => {
    //     rejectRender = reject;
    //     resolve(visitNodes(node));
    // }).then(setDecorations).catch(() => {});
    visitNodes(node).then(setDecorations);
}

function updateLogLevel() {
    // 创建输出通道
    if (!state.outputChannel) {
        state.outputChannel = vscode.window.createOutputChannel('Markless');
    }

    // 确保配置正确获取
    const debugEnabled = state.config.get('debug', false);
    console.log('Markless 调试配置状态:', debugEnabled);
    state.outputChannel.appendLine(`当前配置状态: debug=${debugEnabled}`);

    // 设置日志级别
    if (debugEnabled) {
        log.setLevel("debug");
        console.log('Markless 日志级别设置为: debug');
        state.outputChannel.appendLine('日志级别设置为: debug');
        state.outputChannel.show();
    } else {
        log.setLevel("warn"); // 使用 warn 替代 silent，以便看到重要信息
        console.log('Markless 日志级别设置为: warn');
        state.outputChannel.appendLine('日志级别设置为: warn');
    }

    // 输出测试日志
    log.debug('调试日志测试');
    log.info('信息日志测试');
    log.warn('警告日志测试');
    log.error('错误日志测试');
}

function updateDecorations() {
    // console.log("updateDecorations");
    const editorState = state.getCurrentEditorState();
    if (!editorState) return;

    for (let decoration of editorState.decorationRanges.keys()) {
        editorState.decorationRanges.set(decoration, []); // Reduce failed lookups instead of .clear()
    }
    if (editorState.editor.document.lineCount > 500) {
        for (let range of editorState.editor.visibleRanges) {
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