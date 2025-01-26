const vscode = require('vscode');
const { memoize } = require('./util');

function getSvgDecoration (svgUri, darkMode) {
    return vscode.window.createTextEditorDecorationType({
        textDecoration: "none; display: inline-block; width: 0;",
        before: {
            contentIconPath: vscode.Uri.parse(svgUri),
            textDecoration: `none;${darkMode ? " filter: invert(1)" : ""}`,
        },
    });
}

const hideDecoration = vscode.window.createTextEditorDecorationType({
    color: "transparent",
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    textDecoration: "none; display: inline-block; width: 0;",
});

const transparentDecoration = vscode.window.createTextEditorDecorationType({
    color: "transparent",
});

const getUrlDecoration = memoize((isImage) => vscode.window.createTextEditorDecorationType({
    color: "transparent",
    textDecoration: "none; display: inline-block; width: 0;",
    before: {
        contentText: isImage ? "🌄" : " 🔗",
        fontWeight: "bold",
        color: "cyan",
    },
}));

module.exports = { hideDecoration, transparentDecoration, getUrlDecoration, getSvgDecoration};