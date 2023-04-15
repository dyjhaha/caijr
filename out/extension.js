"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const chatgpt_1 = require("chatgpt");
const path = require("path");
const fs = require("fs");
const cheerio = require("cheerio");
const csv_1 = require("csv");
const node_fetch_1 = require("node-fetch");
function activate(context) {
    console.log('activating extension "chatgpt"');
    // Get the settings from the extension's configuration
    const config = vscode.workspace.getConfiguration('chatgpt-ai');
    // Create a new ChatGPTViewProvider instance and register it with the extension's context
    const provider = new ChatGPTViewProvider(context.extensionPath, context.extensionUri);
    // Put configuration settings into the provider
    provider.setAuthenticationInfo({
        mode: config.get('mode'),
        apiKey: config.get('apiKey'),
        accessToken: config.get('accessToken'),
        proxyUrl: config.get('proxyUrl') === "Custom" ? config.get('customProxyUrl') : config.get('proxyUrl')
    });
    provider.setSettings({
        selectedInsideCodeblock: config.get('selectedInsideCodeblock') || false,
        codeblockWithLanguageId: config.get('codeblockWithLanguageId') || false,
        keepConversation: config.get('keepConversation') || false,
        timeoutLength: config.get('timeoutLength') || 60,
    });
    // Register the provider with the extension's context
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatGPTViewProvider.viewType, provider, {
        webviewOptions: { retainContextWhenHidden: true }
    }));
    vscode.window.onDidChangeTextEditorSelection((event) => provider.setContextSelection(event.textEditor.selection.isEmpty ? 'none' : 'selection'));
    const commandHandler = (command) => {
        const config = vscode.workspace.getConfiguration('chatgpt-ai');
        const prompt = config.get(command);
        provider.askWithContext(prompt, "selection");
    };
    // Register the commands that can be called from the extension's package.json
    context.subscriptions.push(vscode.commands.registerCommand('chatgpt-ai.ask', () => vscode.window.showInputBox({ prompt: 'What do you want to do?' })
        .then((value) => {
        if (value !== undefined && value !== null) {
            provider.askWithContext(value, "selection");
        }
    })), vscode.commands.registerCommand('chatgpt-ai.explain', () => commandHandler('promptPrefix.explain')), vscode.commands.registerCommand('chatgpt-ai.refactor', () => commandHandler('promptPrefix.refactor')), vscode.commands.registerCommand('chatgpt-ai.optimize', () => commandHandler('promptPrefix.optimize')), vscode.commands.registerCommand('chatgpt-ai.findProblems', () => commandHandler('promptPrefix.findProblems')), vscode.commands.registerCommand('chatgpt-ai.documentation', () => commandHandler('promptPrefix.documentation')), vscode.commands.registerCommand('chatgpt-ai.complete', () => commandHandler('promptPrefix.complete')), vscode.commands.registerCommand('chatgpt-ai.resetConversation', () => provider.resetConversation()));
    // Change the extension's session token or settings when configuration is changed
    vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('chatgpt-ai.mode') ||
            event.affectsConfiguration('chatgpt-ai.apiKey') ||
            event.affectsConfiguration('chatgpt-ai.accessToken') ||
            event.affectsConfiguration('chatgpt-ai.proxyUrl')) {
            const config = vscode.workspace.getConfiguration('chatgpt-ai');
            provider.setAuthenticationInfo({
                mode: config.get('mode'),
                apiKey: config.get('apiKey'),
                accessToken: config.get('accessToken'),
                proxyUrl: config.get('proxyUrl') === "Custom" ? config.get('customProxyUrl') : config.get('proxyUrl')
            });
            // clear conversation
            provider.resetConversation();
        }
        else if (event.affectsConfiguration('chatgpt-ai.selectedInsideCodeblock')) {
            const config = vscode.workspace.getConfiguration('chatgpt-ai');
            provider.setSettings({ selectedInsideCodeblock: config.get('selectedInsideCodeblock') || false });
        }
        else if (event.affectsConfiguration('chatgpt-ai.codeblockWithLanguageId')) {
            const config = vscode.workspace.getConfiguration('chatgpt-ai');
            provider.setSettings({ codeblockWithLanguageId: config.get('codeblockWithLanguageId') || false });
        }
        else if (event.affectsConfiguration('chatgpt-ai.keepConversation')) {
            const config = vscode.workspace.getConfiguration('chatgpt-ai');
            provider.setSettings({ keepConversation: config.get('keepConversation') || false });
        }
        else if (event.affectsConfiguration('chatgpt-ai.timeoutLength')) {
            const config = vscode.workspace.getConfiguration('chatgpt-ai');
            provider.setSettings({ timeoutLength: config.get('timeoutLength') || 60 });
        }
        else if (event.affectsConfiguration('chatgpt-ai.indentOnInserting')) {
            const config = vscode.workspace.getConfiguration('chatgpt-ai');
            provider.setSettings({ indentOnInserting: config.get('indentOnInserting') || false });
        }
    });
}
exports.activate = activate;
class ChatGPTViewProvider {
    // In the constructor, we store the URI of the extension
    constructor(_extensionPath, _extensionUri) {
        this._extensionPath = _extensionPath;
        this._extensionUri = _extensionUri;
        // An AbortController for _chatGPTAPI
        this._abortController = new AbortController();
        this._currentMessageNumber = 0;
        this._settings = {
            selectedInsideCodeblock: false,
            codeblockWithLanguageId: false,
            keepConversation: true,
            timeoutLength: 60,
            indentOnInserting: true
        };
        this._prompts = [];
        this._workingState = 'idle';
    }
    // Set the API key and create a new API instance based on this key
    setAuthenticationInfo(authInfo) {
        this._authInfo = authInfo;
        this._newAPI();
    }
    setSettings(settings) {
        this._settings = { ...this._settings, ...settings };
    }
    getSettings() {
        return this._settings;
    }
    _setWorkingState(mode) {
        this._workingState = mode;
        this._view?.webview.postMessage({ type: 'setWorkingState', value: this._workingState });
    }
    _newAPI() {
        if (!this._authInfo) {
            console.warn("Invalid auth info, please set working mode and related auth info.");
            return null;
        }
        const { mode, apiKey, accessToken, proxyUrl } = this._authInfo;
        if (mode === "ChatGPTAPI" && apiKey) {
            this._chatGPTAPI = new chatgpt_1.ChatGPTAPI({
                apiKey: apiKey,
                debug: false
            });
        }
        else if (mode === "ChatGPTUnofficialProxyAPI" && accessToken && proxyUrl) {
            this._chatGPTAPI = new chatgpt_1.ChatGPTUnofficialProxyAPI({
                accessToken: accessToken,
                apiReverseProxyUrl: proxyUrl,
                debug: false
            });
        }
        else {
            console.warn("Invalid auth info, please set working mode and related auth info.");
            return null;
        }
        this._conversation = null;
        this._currentMessageNumber = 0;
        return this._chatGPTAPI;
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        // set options for the webview, allow scripts
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };
        // set the HTML for the webview
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        // add an event listener for messages received by the webview
        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'webviewLoaded':
                    {
                        this._view?.webview.postMessage({ type: 'setWorkingState', value: this._workingState });
                        // this.loadAwesomePrompts();
                        break;
                    }
                case 'loadPrompts':
                    {
                        // force prompts updating
                        // this.loadAwesomePrompts();
                        break;
                    }
                case 'codeSelected': {
                    let code = data.value;
                    const editor = vscode.window.activeTextEditor;
                    if (this._settings.indentOnInserting && editor && !editor.selection.isEmpty) {
                        const selection = editor.selection;
                        const endLine = selection.end.line;
                        const endLineText = editor.document.lineAt(endLine).text;
                        const endIndent = endLineText.match(/^\s*/)?.[0] || '';
                        code = code.trim().replace(/\r?\n/g, `\n${endIndent}`);
                    }
                    // Get active text editor
                    const currentEditor = vscode.window.activeTextEditor;
                    if (currentEditor) {
                        // Get current selection
                        const selection = currentEditor.selection;
                        // Replace selection with snippet text
                        currentEditor.edit((editBuilder) => {
                            editBuilder.replace(selection, code);
                        });
                        // Select and format inserted code
                        let updatedSelection = new vscode.Selection(selection.start.line, selection.start.character, selection.start.line + code.split('\n').length - 1, code.split('\n')[code.split('\n').length - 1].length);
                        currentEditor.selection = updatedSelection;
                        if (this._settings.indentOnInserting) {
                            vscode.commands.executeCommand("editor.action.formatSelection");
                        }
                    }
                    break;
                }
                case 'sendPrompt':
                    {
                        this.askWithContext(data.value.task, data.value.context);
                        break;
                    }
                case 'abort':
                    {
                        this.abort();
                        break;
                    }
                case 'resetConversation':
                    {
                        this.resetConversation();
                        break;
                    }
            }
        });
    }
    _loadAwesomePrompts() {
        // Fetch https://raw.githubusercontent.com/f/awesome-chatgpt-prompts/main/prompts.csv
        (0, node_fetch_1.default)('https://raw.githubusercontent.com/f/awesome-chatgpt-prompts/main/prompts.csv')
            .then(response => response.text())
            .then(csv => {
            (0, csv_1.parse)(csv, { columns: true, relax_quotes: true, ltrim: true, rtrim: true }, (err, output) => {
                const prompts = output.map((row) => row['prompt']);
                this._view?.webview.postMessage({ type: 'promptsLoaded', value: prompts });
            });
        });
    }
    /**
     * Search for matched prompts in the prompts.csv file
     */
    async _searchPrompts(userInput) {
        // If the prompts haven't been loaded yet, fetch them from GitHub
        if (this._prompts?.length === 0) {
            const response = await (0, node_fetch_1.default)('https://raw.githubusercontent.com/f/awesome-chatgpt-prompts/main/prompts.csv');
            const data = await response.text();
            // Parse the CSV data and store it in the prompts array with npm csv
            (0, csv_1.parse)(data, { columns: true, relax_quotes: true, ltrim: true, rtrim: true }, (err, output) => {
                this._prompts = output.map((row) => row.prompt);
            });
        }
        const matchedPrompts = [];
        // Search the prompts array for matches based on the user input
        this._prompts.forEach(prompt => {
            if (typeof prompt === 'string' && prompt.toLowerCase().includes(userInput.toLowerCase())) {
                matchedPrompts.push(prompt);
            }
        });
        return matchedPrompts;
    }
    async resetConversation() {
        if (this._workingState === 'idle') {
            if (this._conversation) {
                this._conversation = null;
            }
            this._currentMessageNumber = 0;
            this._task = '';
            this._response = '';
            this._fullPrompt = '';
            this._view?.webview.postMessage({ type: 'setTask', value: '' });
            this._view?.webview.postMessage({ type: 'clearResponses', value: '' });
            this._view?.webview.postMessage({ type: 'setConversationId', value: '' });
        }
        else {
            console.warn('Conversation is not in idle state. Resetting conversation is not allowed.');
        }
    }
    async askWithContext(task, context) {
        this._task = task || "";
        if (!this._chatGPTAPI) {
            this._newAPI();
        }
        // show chat view
        this._view?.show?.(!this._view);
        let searchPrompt;
        let languageId;
        switch (context) {
            case 'selection':
                const selection = vscode.window.activeTextEditor?.selection;
                const selectedText = selection && vscode.window.activeTextEditor?.document.getText(selection);
                languageId = this._settings.codeblockWithLanguageId
                    ? vscode.window.activeTextEditor?.document?.languageId || ""
                    : "";
                searchPrompt = selectedText ? `${task}\n${"```"}${languageId}\n${selectedText}\n${"```"}\n` : task;
                break;
            case 'whole_file':
                const activeDoc = vscode.window.activeTextEditor?.document;
                languageId = this._settings.codeblockWithLanguageId ? activeDoc?.languageId || "" : "";
                const fileContent = activeDoc ? activeDoc.getText() : "";
                searchPrompt = `${task}\n${"```"}${languageId}\n${fileContent}\n${"```"}\n`;
                break;
            case 'all_opened_files':
                const activeTabGroup = vscode.window.tabGroups.activeTabGroup;
                const tabs = activeTabGroup.tabs;
                if (tabs.length > 0) {
                    let mergedContent = '';
                    const copiedFiles = [];
                    for (const tab of tabs) {
                        const uri = tab.input.uri;
                        if (uri && uri.scheme === 'file') {
                            const filename = uri.fsPath;
                            const content = await vscode.workspace.fs.readFile(uri);
                            mergedContent += `## ${filename}\n\n\`\`\`\n${content}\n\`\`\`\n\n`;
                            copiedFiles.push(filename);
                        }
                    }
                    searchPrompt = `${task}\n${mergedContent}`;
                }
                else {
                    searchPrompt = task;
                }
                break;
            default:
                searchPrompt = task;
        }
        this._fullPrompt = searchPrompt;
        this._askChatGPT(searchPrompt);
    }
    async _askChatGPT(searchPrompt) {
        this._view?.show?.(true);
        if (!this._chatGPTAPI) {
            const errorMessage = "[ERROR] API key not set or wrong, please go to extension settings to set it (read README.md for more info).";
            this._view?.webview.postMessage({ type: "addEvent", value: { text: errorMessage } });
            return;
        }
        this._view?.webview.postMessage({ type: "setTask", value: this._task });
        const requestMessage = {
            type: "addRequest",
            value: { text: searchPrompt, parentMessageId: this._conversation?.parentMessageId },
        };
        this._view?.webview.postMessage(requestMessage);
        this._currentMessageNumber++;
        this._setWorkingState("asking");
        try {
            const currentMessageNumber = this._currentMessageNumber;
            const res = await this._chatGPTAPI.sendMessage(searchPrompt, {
                onProgress: (partialResponse) => {
                    if (partialResponse.id === partialResponse.parentMessageId || this._currentMessageNumber !== currentMessageNumber) {
                        return;
                    }
                    if (this._view?.visible) {
                        const responseMessage = { type: "addResponse", value: partialResponse };
                        this._view?.webview.postMessage(responseMessage);
                    }
                },
                timeoutMs: (this._settings.timeoutLength || 60) * 1000,
                abortSignal: this._abortController.signal,
                ...this._conversation,
            });
            if (this._settings.keepConversation) {
                this._conversation = {
                    conversationId: res.conversationId,
                    parentMessageId: res.id,
                };
                this._view?.webview?.postMessage({ type: "setConversationId", value: res.conversationId });
            }
        }
        catch (e) {
            console.error(e);
            const errorMessage = `[ERROR] ${e}`;
            this._view?.show?.(true);
            this._view?.webview.postMessage({ type: "addEvent", value: { text: errorMessage } });
        }
        this._setWorkingState("idle");
    }
    abort() {
        this._abortController?.abort();
        this._setWorkingState("idle");
        this._view?.webview.postMessage({ type: 'addEvent', value: { text: '[EVENT] Aborted by user.' } });
        // reset the controller
        this._abortController = new AbortController();
    }
    setContextSelection(context) {
        this._view?.webview.postMessage({ type: 'setContextSelection', value: context });
    }
    _getHtmlForWebview(webview) {
        const indexHtmlPath = path.join(this._extensionPath, 'media', 'html', 'index.html');
        const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
        const $ = cheerio.load(indexHtml);
        $('#responses').empty();
        // Remove all <style> tags with class 'editing'
        $('head > link.editing').remove();
        $('head > script.editing').remove();
        // hide div.response_templates
        $('div#response_templates').css('display', 'none');
        // remove all elements of class editing in div#response_templates
        $('div#response_templates .editing').remove();
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'main.js'));
        const tailwindUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'scripts', 'tailwind.min.js'));
        const highlightcssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'styles', 'highlight-vscode.min.css'));
        const jqueryuicssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'styles', 'jquery-ui.css'));
        const indexcssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'styles', 'index.css'));
        return $.html()
            .replace('{{tailwindUri}}', tailwindUri.toString())
            .replace('{{highlightcssUri}}', highlightcssUri.toString())
            .replace('{{jqueryuicssUri}}', jqueryuicssUri.toString())
            .replace('{{indexcssUri}}', indexcssUri.toString())
            .replace('{{scriptUri}}', scriptUri.toString());
    }
}
ChatGPTViewProvider.viewType = 'chatgpt-ai.chatView';
// This method is called when your extension is deactivated
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map