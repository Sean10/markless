const vscode = require('vscode');
const log = require('loglevel');

class MarkdownEditorInfo {
    /**
     * @param {vscode.TextEditor} editor
     */
    constructor(editor) {
        /** @type {vscode.TextEditor} */
        this.editor = editor;
        /** @type {vscode.Selection} */
        this.selection = editor.selection;
        /** @type {Map<vscode.TextEditorDecorationType, vscode.Range[]>} */
        this.decorationRanges = new Map();
        /** @type {Array<[vscode.Range, string, string]>} */
        this.imageList = [];
        /** @type {string} */
        this.text = editor.document.getText();
        /** @type {number|undefined} */
        this.changeRangeOffset = undefined;
        /** @type {number} */
        this.offset = 0;
        /** @type {number} */
        this.size = this.calculateSize();
    }

    calculateSize() {
        // 粗略估算内存占用（字节）
        let size = 0;
        size += this.text.length * 2; // 文本内容
        size += this.imageList.length * 1000; // 图片列表（保守估计）

        // 装饰器占用
        for (const [_, ranges] of this.decorationRanges) {
            size += ranges.length * 100; // 每个范围对象的大致大小
        }

        return size;
    }

    clearDecorations() {
        for (let decoration of this.decorationRanges.keys()) {
            this.editor.setDecorations(decoration, []);
        }
        this.decorationRanges.clear();
    }

    update() {
        this.text = this.editor.document.getText();
        this.size = this.calculateSize();
    }
}

class EditorState {
    constructor() {
        /** @type {Map<string, MarkdownEditorInfo>} */
        this.editors = new Map(); // 存储多文件状态
        /** @type {string[]} */
        this.editorQueue = []; // LRU队列
        /** @type {vscode.TextEditor|undefined} */
        this.activeEditor = undefined;
        /** @type {vscode.WorkspaceConfiguration|undefined} */
        this.config = undefined;
        /** @type {boolean|undefined} */
        this.darkMode = undefined;
        /** @type {number|undefined} */
        this.fontSize = undefined;
        /** @type {string|undefined} */
        this.fontFamily = undefined;
        /** @type {number|undefined} */
        this.lineHeight = undefined;
        /** @type {boolean} */
        this.enabled = true;
        /** @type {vscode.ExtensionContext|undefined} */
        this.context = undefined;
        /** @type {Map<string, any>|undefined} */
        this.types = undefined;
        /** @type {boolean|undefined} */
        this.autoImagePreview = undefined;
        /** @type {vscode.CommentController|undefined} */
        this.commentController = undefined;
        /** @type {Map<string, any>} */
        this.rangeMap = new Map();
        /** @type {Array<[vscode.Range, string, string]>} */
        this.imageList = [];
        /** @type {vscode.Selection|undefined} */
        this.selection = undefined;
        /** @type {Map<vscode.TextEditorDecorationType, vscode.Range[]>} */
        this.decorationRanges = new Map();
        /** @type {string|undefined} */
        this.text = undefined;
        /** @type {vscode.OutputChannel|undefined} */
        this.outputChannel = undefined;

        // 内存管理配置
        /** @type {number} */
        this.maxMemoryUsage = 1024 * 1024 * 1024; // 1GB
        /** @type {number} */
        this.currentMemoryUsage = 0;
    }

    getCurrentEditorState() {
        if (!this.activeEditor) return null;
        const uri = this.activeEditor.document.uri.toString();
        return this.editors.get(uri);
    }

    setActiveEditor(editor) {
        if (editor && editor.document.languageId === "markdown") {
            const uri = editor.document.uri.toString();

            // 如果是新文件
            if (!this.editors.has(uri)) {
                const editorInfo = new MarkdownEditorInfo(editor);
                this.editors.set(uri, editorInfo);
                this.currentMemoryUsage += editorInfo.size;
                this.editorQueue.push(uri);

                log.warn('新文件被打开:', {
                    uri,
                    currentEditors: Array.from(this.editors.keys()),
                    editorsCount: this.editors.size,
                    memoryUsage: {
                        current: this.currentMemoryUsage,
                        max: this.maxMemoryUsage,
                        fileSize: editorInfo.size
                    }
                });

                // 检查内存使用
                this.checkAndCleanMemory();
            } else {
                // 更新已有文件的位置到队列末尾
                const index = this.editorQueue.indexOf(uri);
                if (index > -1) {
                    this.editorQueue.splice(index, 1);
                }
                this.editorQueue.push(uri);

                // 更新文件状态
                const editorInfo = this.editors.get(uri);
                if (editorInfo) {
                    const oldSize = editorInfo.size;
                    editorInfo.update();
                    const newSize = editorInfo.size;
                    this.currentMemoryUsage += (newSize - oldSize);

                    log.info('已存在文件被打开:', {
                        uri,
                        currentEditors: Array.from(this.editors.keys()),
                        editorsCount: this.editors.size,
                        memoryUsage: {
                            current: this.currentMemoryUsage,
                            max: this.maxMemoryUsage,
                            oldSize,
                            newSize,
                            diff: newSize - oldSize
                        }
                    });
                }
            }

            this.activeEditor = editor;
            return true;
        }
        this.activeEditor = undefined;
        return false;
    }

    checkAndCleanMemory() {
        while (this.currentMemoryUsage > this.maxMemoryUsage && this.editorQueue.length > 1) {
            const oldestUri = this.editorQueue.shift(); // 移除最早的文件
            if (!oldestUri) continue;

            const editorInfo = this.editors.get(oldestUri);
            if (!editorInfo) continue;

            // 如果是当前活动的编辑器，跳过
            if (oldestUri === this.activeEditor?.document.uri.toString()) {
                this.editorQueue.push(oldestUri);
                continue;
            }

            // 清理资源
            editorInfo.clearDecorations();
            this.currentMemoryUsage -= editorInfo.size;
            this.editors.delete(oldestUri);

            log.debug(`清理文件缓存: ${oldestUri}, 释放内存: ${editorInfo.size} bytes`);
        }
    }

    getMemoryStats() {
        return {
            totalMemoryUsage: this.currentMemoryUsage,
            maxMemoryUsage: this.maxMemoryUsage,
            cachedFiles: this.editorQueue.length,
            memoryUsagePerFile: Array.from(this.editors.entries()).map(([uri, info]) => ({
                uri,
                size: info.size,
                lastAccessed: this.editorQueue.indexOf(uri)
            }))
        };
    }
}

const state = new EditorState();
module.exports = { state, MarkdownEditorInfo };