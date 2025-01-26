const vscode = require('vscode');
const { hideDecoration, transparentDecoration, getUrlDecoration, getSvgDecoration } = require('./common-decorations');
const { state } = require('./state');
const { memoize, nodeToHtml, svgToUri, htmlToSvg, DefaultMap, texToSvg, enableHoverImage, path } = require('./util');
const { triggerUpdateDecorations, addDecoration, posToRange, updateLogLevel } = require('./runner');
const cheerio = require('cheerio');
const { createImportSpecifier } = require('typescript');
const log = require('loglevel');
const { getLogger } = require('loglevel');

let config = vscode.workspace.getConfiguration("markless");
const LIST_BULLETS = ["•", "○", "■"];

function enableLineRevealAsSignature(context) {
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider('markdown', {
        provideSignatureHelp: (document, position) => {
            const editorState = state.getCurrentEditorState();
            if (!editorState) return;

            // 验证行号是否有效
            if (position.line < 0 || position.line >= document.lineCount) {
                log.warn(`Invalid line number: ${position.line}, document has ${document.lineCount} lines`);
                return;
            }

            const cursorPosition = editorState.selection.active;
            let latexElement = undefined;
            let start = editorState.editor.document.offsetAt(cursorPosition) + 2;
            let end = start - 3;

            while (--start > 0) {
                if (editorState.text[start-1] === '$' && editorState.text[start] !== ' ') {
                    while (++end < editorState.text.length) {
                        if (editorState.text[end] === '$' && editorState.text[end-1] !== ' ') {
                            if (start < end)
                                latexElement = `![latexPreview](${svgToUri(texToSvg(editorState.text.slice(start, end)))})`;
                            break;
                        }
                    }
                    break;
                }
            }

            try {
                const text = document.lineAt(position.line).text
                    .replace(new RegExp(`(?<=^.{${position.character}})`), "█");
                const ms = new vscode.MarkdownString(latexElement);
                ms.isTrusted = true;
                if (!latexElement) {
                    ms.appendCodeblock(text, "markdown");
                }
                return {
                    activeParameter: 0,
                    activeSignature: 0,
                    signatures: [new vscode.SignatureInformation("", ms)],
                };
            } catch (error) {
                log.error(`Error accessing line ${position.line}: ${error.message}`);
                return null;
            }
        }
    }, '\\'));
}

let requestSvg, webviewLoaded;
function registerWebviewViewProvider (context) {
	let resolveWebviewLoaded, resolveSvg;
	webviewLoaded = new Promise(resolve => { resolveWebviewLoaded = resolve; });
	context.subscriptions.push(vscode.window.registerWebviewViewProvider("test.webview", {
		resolveWebviewView: (webviewView) => {
			webviewView.webview.options = { enableScripts: true };
			const mermaidScriptUri = "https://cdnjs.cloudflare.com/ajax/libs/mermaid/8.12.1/mermaid.min.js";
			webviewView.webview.html = `
					<!DOCTYPE html>
					<html lang="en">
						<body>
						<script src="${mermaidScriptUri}"></script>
						<script>
						// console.log("WEBVIEW ENTER");

						const vscode = acquireVsCodeApi();
						window.addEventListener('message', event => {
							const data = event.data;
							mermaid.mermaidAPI.initialize({
								theme: data.darkMode? "dark":"default",
								fontFamily: data.fontFamily,
								startOnLoad: false
							});
							// console.log("init done");
							// console.log("WEBVIEW RECIEVE FROM EXTENSION", event)
							vscode.postMessage(mermaid.mermaidAPI.render('mermaid', data.source));
						});

						</script>
						</body>
						</html>
						`;
			webviewView.webview.onDidReceiveMessage((svgString) => {
				// console.log(svgString);
				resolveSvg(svgString);
			}, null, context.subscriptions);
			requestSvg = x => {
				webviewView.webview.postMessage(x);
				return new Promise(resolve => { resolveSvg = resolve; });
			};
			resolveWebviewLoaded();
		}
	}, { webviewOptions: { retainContextWhenHidden: true } }));
	vscode.commands.executeCommand('workbench.view.extension.markless')
		.then(() => vscode.commands.executeCommand('workbench.view.explorer'));
}


function clearDecorations() {
	if (!state.decorationRanges) return;
	for (let decoration of state.decorationRanges.keys()) {
		state.activeEditor.setDecorations(decoration, []);
	}
}

function toggle() {
	if (state.enabled) {
		clearDecorations();
		state.enabled = false;
	} else {
		state.enabled = true;
		triggerUpdateDecorations();
	}
}

function bootstrap(context) {
    state.enabled = true;
    state.context = context;
	clearDecorations();
    state.decorationRanges = new DefaultMap(() => []);
	state.rangeMap = new DefaultMap();
    state.config = config;
    state.darkMode = vscode.window.activeColorTheme.kind == vscode.ColorThemeKind.Dark;
    state.fontSize = vscode.workspace.getConfiguration("editor").get("fontSize", 14);
    state.fontFamily = vscode.workspace.getConfiguration("editor").get("fontFamily", "Courier New");
    const lineHeight = vscode.workspace.getConfiguration("editor").get("lineHeight", 0);

    // 初始化日志系统
    if (!state.outputChannel) {
        state.outputChannel = vscode.window.createOutputChannel('Markless');
    }

    // 配置日志输出
    const originalFactory = log.methodFactory;
    log.methodFactory = function (methodName, logLevel, loggerName) {
        const rawMethod = originalFactory(methodName, logLevel, loggerName);
        return function (message, ...args) {
            if (state.outputChannel) {
                const output = typeof message === 'string' ? message : JSON.stringify(message);
                const argsOutput = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
                const logMessage = `[${methodName.toUpperCase()}] ${output} ${argsOutput}`;
                state.outputChannel.appendLine(logMessage);
                console.log('Markless:', logMessage);
            }
            rawMethod(message, ...args);
        };
    };

    // 设置初始日志级别
    log.setLevel(state.config?.get('debug', false) ? "debug" : "warn");
    log.info('Markless 扩展激活');

	updateLogLevel();

    // 输出初始化信息
    log.info('Markless 扩展初始化完成', {
        darkMode: state.darkMode,
        fontSize: state.fontSize,
        fontFamily: state.fontFamily
    });

    // https://github.com/microsoft/vscode/blob/45aafeb326d0d3d56cbc9e2932f87e368dbf652d/src/vs/editor/common/config/fontInfo.ts#L54
    if (lineHeight === 0) {
        state.lineHeight = Math.round(process.platform == "darwin" ? 1.5 * state.fontSize : 1.35 * state.fontSize);
    } else if (lineHeight < 8) {
        state.lineHeight = 8;
    }
	// console.log("lineHeight: ", state.lineHeight, "fontSize:", state.fontSize);
    state.autoImagePreview = state.config.get('inlineImage.autoPreview');

	// @ts-ignore
	state.types = new Map([
		["heading", ["heading", (() => {
			const getEnlargeDecoration = memoize((size) => vscode.window.createTextEditorDecorationType({
				textDecoration: `; font-size: ${size}px; position: relative; top: 0.1em;`,
			}));
			const getlistRainbowDecoration = (() => {
				const hueRotationMultiplier = [0, 5, 9, 2, 6, 7];
				const getNonCyclicDecoration = memoize((level) => vscode.window.createTextEditorDecorationType({
					textDecoration: (`; filter: hue-rotate(${hueRotationMultiplier[level] * 360 / 12}deg);`),
				}));
				return (level) => {
					level = level % hueRotationMultiplier.length;
					return getNonCyclicDecoration(level);
				};
			})();

			return (start, end, node) => {
				const editorState = state.getCurrentEditorState();
				if (!editorState) {
					log.error("标题装饰: editorState 为空");
					return;
				}
				log.debug("标题装饰开始处理", {start, end, node});

				let posStart = posToRange(start, end);
				if (!posStart) {
					log.error("标题装饰: posStart 转换失败", {start, end});
					return;
				}
				log.debug("posStart: ", posStart, posStart.start, posStart.start.line);

				let range = editorState.editor.document.lineAt(posStart.start).range;
				if (!range) {
					log.error("标题装饰: 获取行范围失败", {posStart});
					return;
				}
				let value = editorState.editor.document.getText(range);
				log.debug("标题装饰内容:", {range, value});
				let endSymbolNeedDecoration = 0;

				if (value.startsWith("#")){
					endSymbolNeedDecoration = start + node.depth + 1;
					log.debug("标题装饰: # 开头", {endSymbolNeedDecoration});
				} else {
					endSymbolNeedDecoration = start;
					log.debug("标题装饰: 非 # 开头", {endSymbolNeedDecoration});
				}
				addDecoration(hideDecoration, start, endSymbolNeedDecoration);
				addDecoration(getEnlargeDecoration(state.fontSize + Math.ceil(state.fontSize) / 6 * (7 - node.depth)), endSymbolNeedDecoration, end);
				addDecoration(getlistRainbowDecoration(node.depth), endSymbolNeedDecoration, end);
			};
		})()]],
		["horizontalRule", ["thematicBreak", (() => {
			const horizontalRuleDecoration = vscode.window.createTextEditorDecorationType({
				color: "transparent",
				textDecoration: "none; display: inline-block; width: 0;",
				before: {
					contentText: "",
					textDecoration: "none; position: absolute; background: #ffaa00; top: 0.49em; bottom: 0.49em; width: 100%; mix-blend-mode: luminosity; border: outset;",
				}
			});
			return (start, end, node) => {
				addDecoration(horizontalRuleDecoration, start, end);
			};
		})()]],
		["quote", ["blockquote", (() => {
			const quoteDecoration = vscode.window.createTextEditorDecorationType({
				textDecoration: "none;",
			});
			const quoteBarDecoration = vscode.window.createTextEditorDecorationType({
				color: "transparent",
				before: {
					contentText: "",
					textDecoration: "none; position: absolute; background: #ffaa00; top: -0.2em; bottom: -0.2em; width: 3px; border-radius: 99px; mix-blend-mode: luminosity;",
				}
			});
			return (start, end, node) => {
				const editorState = state.getCurrentEditorState();
				if (!editorState) return;
				addDecoration(quoteDecoration, start, end);
				const text = editorState.text.slice(start, end);
				const regEx = /^ {0,3}>/mg;
				let match;
				while ((match = regEx.exec(text))) {
					addDecoration(quoteBarDecoration, start + match.index + match[0].length - 1, start + match.index + match[0].length);
				}
			};
		})()]],
		["list", ["listItem", (() => {
			const getBulletDecoration = memoize((level) => {
				return vscode.window.createTextEditorDecorationType({
					color: "transparent",
					textDecoration: "none; display: inline-block; width: 0;",
					after: {
						contentText: LIST_BULLETS[level % LIST_BULLETS.length],
						fontWeight: "bold"
					},
				});
			});
			const getCheckedDecoration = memoize((checked) => {
				return vscode.window.createTextEditorDecorationType({
					color: "transparent",
					textDecoration: "none; display: inline-block; width: 0;",
					after: {
						contentText: checked ? "☑" : "☐",
						fontWeight: "bold"
					},
				});
			});
			const getlistRainbowDecoration = (() => {
				const hueRotationMultiplier = [0, 5, 9, 2, 6, 7];
				const getNonCyclicDecoration = memoize((level) => vscode.window.createTextEditorDecorationType({
					textDecoration: (`; filter: hue-rotate(${hueRotationMultiplier[level] * 360 / 12}deg);`),
				}));
				return (level) => {
					level = level % hueRotationMultiplier.length;
					return getNonCyclicDecoration(level);
				};
			})();
			return (start, _end, node, listLevel) => {
				log.debug("decorate list", posToRange(start, _end).start.line, node, listLevel);
				if (node.children.length === 0) return;
				const textPosition = node.children[0].position;
				const textStart = textPosition.start.offset;
				const textEnd = textPosition.end.offset;
				if (!node.isOrdered) {
					// addDecoration(node.checked == null ? getBulletDecoration(listLevel) : getCheckedDecoration(node.checked), start, textStart - 1);
					if (node.checked == null) {
						log.debug("getBulletDecoration: ", posToRange(start, _end).start.line, node, getBulletDecoration(listLevel));
						addDecoration(getBulletDecoration(listLevel), start, textStart - 1);
					} else {
						log.debug("getCheckedDecoration: ", posToRange(start, _end).start.line, node, getCheckedDecoration(node.checked));
						addDecoration(getCheckedDecoration(node.checked), start, textStart - 1);
					}
				}
				// console.log("wc: node: ", JSON.stringify(node));
				// console.log("wc: listLevel: ", listLevel);
				addDecoration(getlistRainbowDecoration(listLevel), textStart, textEnd);
			};
		})()]],
		["latex", ["math", (() => {
			const getTexDecoration = (() => {
				const _getTexDecoration = memoize((texString, display, darkMode, fontSize, height) => {
					const svgUri = svgToUri(texToSvg(texString, display, height));
					return getSvgDecoration(svgUri, darkMode);
				});
				return (texString, display, numLines) => _getTexDecoration(texString, display, state.darkMode, state.fontSize, numLines * state.lineHeight);
			})();
			return (start, end, node) => {
				const editorState = state.getCurrentEditorState();
				if (!editorState) return;
				const latexText = editorState.text.slice(start, end);
				const match = /^(\$+)([^]+)\1/.exec(latexText);
				if (!match) return;
				const numLines = 1 + (latexText.match(/\n/g)||[]).length;
				addDecoration(getTexDecoration(match[2], match[1].length > 1, numLines), start, end);
			};
		})()]],
		["latex", ["inlineMath", (start, end) => state.types.get("math")(start, end)]],
		["emphasis", ["emphasis", (start, end, node) => {
			addDecoration(hideDecoration, start, start + 1);
			addDecoration(hideDecoration, end - 1, end);
		}]],
		["emphasis", ["strong", (start, end, node) => {
			addDecoration(hideDecoration, start, start + 2);
			addDecoration(hideDecoration, end - 2, end);
		}]],
		["inlineCode", ["inlineCode", (() => {
			const codeDecoration = vscode.window.createTextEditorDecorationType({
				border: "outset",
				borderRadius: "5px",
			})
			return (start, end, node) => {
				addDecoration(codeDecoration, start, end);
				addDecoration(transparentDecoration, start, start + 1);
				addDecoration(transparentDecoration, end - 1, end);
			};
		})()]],
		["mermaid", ["code", (() => {
			const getMermaidDecoration = (() => {
				const _getTexDecoration = memoize(async (source, darkMode, height, fontFamily) => {
					await webviewLoaded;
					const svgString = await requestSvg({ source: source, darkMode: darkMode, fontFamily: fontFamily });
					const svgNode = cheerio.load(svgString)('svg');
					const maxWidth = parseFloat(svgNode.css('max-width')) * height / parseFloat(svgNode.attr('height'));
					const svg = svgNode
						.css('max-width', `${maxWidth}px`)
						.attr('height', `${height}px`)
						.attr("preserveAspectRatio", "xMinYMin meet")
						.toString()
					const svgUri = svgToUri(svg);
					return getSvgDecoration(svgUri, false); // Using mermaid theme instead
				});
				return (source, numLines) => _getTexDecoration(source, state.darkMode, (numLines + 2) * state.lineHeight, state.fontFamily);
			})();
			return async (start, end, node) => {
				if (!(node.lang === "mermaid")) return;
				const editorState = state.getCurrentEditorState();
				if (!editorState) return;
				const match = editorState.text.slice(start, end).match(/^(.)(\1{2,}).*?\n([^]+)\n\1{3,}$/);
				if (!match) return;
				const source = match[3]
					, numLines = 1 + (source.match(/\n/g) || []).length;
				const decoration = await getMermaidDecoration(source, numLines);
				if (decoration) {
					addDecoration(decoration, start, end);
				}
			};
		})()]],
		["link", ["link", (start, end, node) => {
			const editorState = state.getCurrentEditorState();
			if (!editorState) return;
			const text = editorState.text.slice(start, end);
			const match = /\[(.+)\]\(.+?\)/.exec(text);
			if (!match) return;
			addDecoration(hideDecoration, start, start + 1);
			addDecoration(getUrlDecoration(false), start + match[1].length + 1, end);
		}]],
		["html", ["html", (() => {
			const htmlDecoration = vscode.window.createTextEditorDecorationType({
				color: "transparent",
				textDecoration: "none; display: inline-block; width: 0;",
				before: {
					contentText: "</>",
					fontWeight: "bold",
					textDecoration: "none; font-size: small; vertical-align: middle;",
					color: "cyan",
				},
			});
			return (start, end, node) => {
				const editorState = state.getCurrentEditorState();
				if (!editorState) return;
				const text = editorState.text.slice(start, end);
				const match = /(<.+?>).+(<\/.+?>)/.exec(text);
				if (match) {
					addDecoration(htmlDecoration, start, start + match[1].length);
					addDecoration(htmlDecoration, end - match[2].length, end);
				} else {
					addDecoration(htmlDecoration, start, end);
				}
			}
		})()]],
		["link", ["image", (start, end, node) => {
			const editorState = state.getCurrentEditorState();
			if (!editorState) return;
			const text = editorState.text.slice(start, end);
			const match = /!\[(.*)\]\(.+?\)/.exec(text);
			if (!match) return;
			addDecoration(hideDecoration, start, start + 2);
			addDecoration(getUrlDecoration(true), start + match[1].length + 2, end);

			// 获取当前范围
			const currentRange = posToRange(start, end);

			// 检查是否已存在相同位置和路径的图片
			if (node.url.startsWith("http")) {
				// 检查重复
				const isDuplicate = editorState.imageList.some(([existingRange, existingPath]) =>
					existingPath === node.url &&
					existingRange.start.line === currentRange.start.line &&
					existingRange.start.character === currentRange.start.character
				);

				if (!isDuplicate) {
					editorState.imageList.push([currentRange, node.url, node.alt || " "]);
				}
				return;
			}

			const editor = vscode.window.activeTextEditor;
			const mdFilePath = editor.document.uri.fsPath;
			let imgPath;

			// 检查是否在远程环境
			const isRemote = vscode.env.remoteName !== undefined;

			// 获取图片的绝对路径
			const absolutePath = path.resolve(path.dirname(mdFilePath), node.url);

			if (isRemote) {
				const fileUri = vscode.Uri.file(absolutePath);
				imgPath = fileUri.toString();
			} else {
				if (process.platform === 'win32') {
					imgPath = `file:///${absolutePath.replace(/\\/g, '/')}`;
				} else {
					imgPath = `file://${absolutePath}`;
				}
			}

			// 检查重复
			const isDuplicate = editorState.imageList.some(([existingRange, existingPath]) =>
				existingPath === imgPath &&
				existingRange.start.line === currentRange.start.line &&
				existingRange.start.character === currentRange.start.character
			);

			if (!isDuplicate) {
				editorState.imageList.push([currentRange, imgPath, node.alt || " "]);
			}
		}]],
		["emphasis", ["delete", (() => {
			const strikeDecoration = vscode.window.createTextEditorDecorationType({
				textDecoration: "line-through"
			});
			return (start, end, node) => {
				addDecoration(hideDecoration, start, start + 2);
				addDecoration(hideDecoration, end - 2, end);
				addDecoration(strikeDecoration, start + 2, end - 2);
			};
		})()]],
		["table", ["table", (() => {
			const getTableDecoration = memoize((html, darkMode, fontFamily, fontSize, lineHeight) => {
				const numRows = 1 + (html.match(/<tr>/g) || []).length;
				const css = `
				table { border-collapse: collapse; }
				th { border-bottom : groove; }
				td { border-bottom : inset; }
				td, th {padding:${fontSize*0.1}px 0.5em;}
				/*td,th { height: ${lineHeight*0.9}px;}*/
				body {
					font-family:${fontFamily.replace(/(?<!\\)"/g, "'")};
					font-size: ${fontSize*0.9}px;
				}
				`;
				const temp = html.match(/<tr>[^]+?<\/tr>/g)
					.map(r => r.replace(/^<tr>\n<t[dh]>/, '').split(/<t[dh]>/)
						.map(c => c.replace(/<\/?("[^"]*"|'[^']*'|[^>])*(>|$)/g, "")))
				const maxLength = temp.reduce((acc, cur) => acc.map((val, idx) => Math.max(val, cur[idx].length)), Array(temp[0].length).fill(0))
					.reduce((acc, cur)=>acc+cur);
				const tableUri = svgToUri(htmlToSvg(numRows * lineHeight, maxLength * fontSize, html, css));
				return vscode.window.createTextEditorDecorationType({
					color: "transparent",
					textDecoration: "none; display: inline-block; width: 0;",
					before: {
						contentIconPath: vscode.Uri.parse(tableUri),
						textDecoration: `none;${darkMode ? " filter: invert(1)" : ""}`,
					},
				});
			});
			return (start, end, node) => {
				const html = nodeToHtml(node);
				log.error(html);
				addDecoration(getTableDecoration(html, state.darkMode, state.fontFamily, state.fontSize, state.lineHeight), start, end);
			};
		})()]]
	// @ts-ignore
	].filter(e=>state.config.get(e[0])).map(e => e[1]));

	state.activeEditor = vscode.window.activeTextEditor;
	if (state.activeEditor) {
        if (state.activeEditor.document.languageId == "markdown") {
			state.selection = state.activeEditor.selection;
			triggerUpdateDecorations();
        } else {
            state.activeEditor = undefined;
        }
	}
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // 初始化日志系统
    if (!state.outputChannel) {
        state.outputChannel = vscode.window.createOutputChannel('Markless');
    }

    // 配置日志输出
    const originalFactory = log.methodFactory;
    log.methodFactory = function (methodName, logLevel, loggerName) {
        const rawMethod = originalFactory(methodName, logLevel, loggerName);
        return function (message, ...args) {
            if (state.outputChannel) {
                const output = typeof message === 'string' ? message : JSON.stringify(message);
                const argsOutput = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
                const logMessage = `[${methodName.toUpperCase()}] ${output} ${argsOutput}`;
                state.outputChannel.appendLine(logMessage);
                console.log('Markless:', logMessage);
            }
            rawMethod(message, ...args);
        };
    };

    // 设置初始日志级别
    log.setLevel(state.config?.get('debug', false) ? "debug" : "warn");
    log.info('Markless 扩展激活');

	if (config.get('mermaid')) {
		registerWebviewViewProvider(context);
	}
	if (config.get("hoverImage")) {
		enableHoverImage(context);
	}
	enableLineRevealAsSignature(context);
    context.subscriptions.push(vscode.commands.registerCommand("markless.toggle", toggle));
	state.imageList = [];
    state.commentController = vscode.comments.createCommentController("inlineImage", "Show images inline");
    context.subscriptions.push(state.commentController);
	bootstrap(context);

	vscode.window.onDidChangeTextEditorVisibleRanges(event => {
		const editorState = state.getCurrentEditorState();
		if (editorState && editorState.editor.document.lineCount > 500 && event.textEditor.document === editorState.editor.document) {
			triggerUpdateDecorations();
		}
	}, null, context.subscriptions);

	vscode.window.onDidChangeActiveTextEditor(editor => {
		if (state.setActiveEditor(editor)) {
			const editorState = state.getCurrentEditorState();
			if (editorState) {
				editorState.update();
				triggerUpdateDecorations();
			}
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidChangeTextDocument(event => {
		const editorState = state.getCurrentEditorState();
		if (editorState && event.document === editorState.editor.document) {
			editorState.text = event.document.getText();
			if (event.contentChanges.length == 1) {
				editorState.changeRangeOffset = event.contentChanges[0].rangeOffset;
			}
			editorState.update();
			triggerUpdateDecorations();
			editorState.changeRangeOffset = undefined;
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidChangeConfiguration(e => {
		if (['markless', 'workbench.colorTheme', 'editor.fontSize'].some(c=>e.affectsConfiguration(c))) {
			state.config = vscode.workspace.getConfiguration("markless");
			updateLogLevel();
			if (state.activeEditor) {
				bootstrap(context);
			}
		}
	}, null, context.subscriptions);

	vscode.window.onDidChangeTextEditorSelection((e) => {
		const editorState = state.getCurrentEditorState();
		if (editorState) {
			editorState.selection = e.selections[0];
			editorState.update();
			triggerUpdateDecorations();
		}
	}, null, context.subscriptions);
}

module.exports = {
	activate,
};