"use strict";
// @ts-ignore 
Object.defineProperty(exports, "__esModule", { value: true });
const marked = require("marked");
const highlight_js_1 = require("highlight.js");
const $ = require("jquery");
require("jquery-ui/ui/widgets/autocomplete");
// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
    const vscode = acquireVsCodeApi();
    let response = '';
    let workingState = 'idle';
    let cachedPrompts = [];
    // Handle messages sent from the extension to the webview
    window.addEventListener("message", (event) => {
        const message = event.data;
        switch (message.type) {
            case "addResponse": {
                // const chatResponse: ChatResponse = message.value;
                // response = message.value;
                updateResponse(message.value);
                break;
            }
            case "addRequest": {
                updateRequest(message.value);
                break;
            }
            case "addEvent": {
                updateEvent(message.value);
                break;
            }
            case "clearResponses": {
                clearResponses();
                break;
            }
            case "setTask": {
                $('#prompt-input').val(message.value);
                break;
            }
            case "setWorkingState": {
                setWorkingState(message.value);
                break;
            }
            case "setConversationId": {
                updateConversationId(message.value);
                break;
            }
            case "promptsLoaded": {
                cachedPrompts = message.value;
                break;
            }
            case 'setContextSelection': {
                const selection = message.value;
                $('#context-select').val(selection);
                // set the value of html selection context-select to message.value with jQuery
                break;
            }
        }
    });
    function updateConversationId(id) {
        $('#conversation-id').text(`Conversation ID: ${id || '/'}`);
    }
    function fixCodeBlocks(response) {
        const REGEX_CODEBLOCK = new RegExp('\`\`\`', 'g');
        const matches = response.match(REGEX_CODEBLOCK);
        const count = matches ? matches.length : 0;
        return count % 2 === 0 ? response : response.concat('\n\`\`\`');
    }
    let lastResponse = null;
    function updateResponse(response) {
        const responsesDiv = $('#responses');
        let updatedResponseDiv = null;
        if (responsesDiv.children().length > 0 && (response.id === null || response?.id === lastResponse?.id)) {
            // Update the existing response
            updatedResponseDiv = responsesDiv.children().last();
        }
        else {
            // Create a new div and append it to the "response" div
            const newDiv = $('<div>').addClass('response m-1 p-1 bg-slate-800');
            responsesDiv.append(newDiv);
            updatedResponseDiv = newDiv;
        }
        updateMessageDiv(updatedResponseDiv, response.text);
        const timestamp = new Date().toLocaleString();
        updatedResponseDiv.append($('<div>').text(timestamp).addClass('timestamp text-xs text-gray-500'));
        lastResponse = response;
        // Scroll to the bottom of the messages container
        const messagesContainer = $('#messages-container');
        messagesContainer.scrollTop(messagesContainer[0].scrollHeight);
    }
    function updateMessageDiv(div, text) {
        const markedOptions = {
            renderer: new marked.Renderer(),
            highlight: (code, lang) => {
                return highlight_js_1.default.highlightAuto(code).value;
            },
            langPrefix: 'hljs language-',
            pedantic: false,
            gfm: true,
            breaks: false,
            sanitize: false,
            smartypants: false,
            xhtml: false
        };
        marked.setOptions(markedOptions);
        var fixedResponseText = fixCodeBlocks(text);
        const html = marked.parse(fixedResponseText);
        // Create a new div with ID "rendered"
        const renderedDiv = $('<div>').attr('id', 'rendered');
        renderedDiv.html(html);
        // Create a new div with ID "raw"
        const rawDiv = $('<div>').attr('id', 'raw');
        // Create a new pre tag for the code snippet and add CSS to wrap the content and enable x-axis overflow scrollbar
        const preTag = $('<pre>').addClass('hljs').css({ 'overflow-x': 'auto' }).appendTo(rawDiv);
        // Create a new code tag for the code snippet
        const codeTag = $('<code>').addClass('markdown').text(text).appendTo(preTag);
        // Highlight the code snippet using hljs
        highlight_js_1.default.highlightBlock(codeTag[0]);
        const toolbarMessageCopy = $('div#response_templates > div#toolbar-message').clone();
        // Add click event listener to markdownBtn
        toolbarMessageCopy.find('button.markdown-btn').on('click', function () {
            renderedDiv.toggle();
            rawDiv.toggle();
        });
        toolbarMessageCopy.find('button.delete-btn').on('click', function () {
            toolbarMessageCopy.parent().remove();
        });
        div.empty().prepend(toolbarMessageCopy).append(renderedDiv).append(rawDiv.hide());
        renderedDiv.find('pre > code').each((i, codeBlock) => {
            const code = $(codeBlock)?.text();
            const toolbarCopy = $('div#response_templates > div#toolbar-code').clone();
            toolbarCopy.insertBefore($(codeBlock).parent());
            // Add click event listener to button element
            toolbarCopy.find('button.insert-btn').on('click', (e) => {
                e.preventDefault();
                if (code) {
                    vscode.postMessage({
                        type: 'codeSelected',
                        value: code
                    });
                }
            });
            toolbarCopy.find('button.copy-btn').on('click', (e) => {
                e.preventDefault();
                navigator.clipboard.writeText(code).then(() => {
                    console.log('Code copied to clipboard');
                    const popup = createCodeSnippetPopup('Code copied to clipboard');
                    $('body').append(popup);
                    setTimeout(() => {
                        popup.remove();
                    }, 2000);
                });
            });
            $(codeBlock).addClass('hljs');
        });
    }
    function createCodeSnippetPopup(text) {
        const popup = $('<div>').text(text).addClass('text-xs font-medium leading-5 text-white bg-green-500 p-2 rounded-sm absolute top-0 right-0 mt-2 mr-2');
        return popup;
    }
    function clearResponses() {
        $("#responses").empty();
        lastResponse = null;
    }
    function updateRequest(request) {
        const responsesDiv = $('#responses');
        let updatedRequestDiv = $('<div>').addClass('request m-1 p-1');
        responsesDiv.append(updatedRequestDiv);
        updateMessageDiv(updatedRequestDiv, request.text);
        const timestamp = new Date().toLocaleString();
        updatedRequestDiv.append($('<div>').text(timestamp).addClass('timestamp text-xs text-gray-500'));
        // Scroll to the bottom of the messages container
        const messagesContainer = $('#messages-container');
        messagesContainer.scrollTop(messagesContainer[0].scrollHeight);
    }
    function updateEvent(event) {
        const responsesDiv = $('#responses');
        let updatedRequestDiv = $('<div>').addClass('event m-1 p-1 text-gray-500');
        responsesDiv.append(updatedRequestDiv);
        updateMessageDiv(updatedRequestDiv, event.text);
        const timestamp = new Date().toLocaleString();
        updatedRequestDiv.append($('<div>').text(timestamp).addClass('timestamp text-xs text-gray-500'));
        // Scroll to the bottom of the messages container
        const messagesContainer = $('#messages-container');
        messagesContainer.scrollTop(messagesContainer[0].scrollHeight);
    }
    function setWorkingState(state) {
        workingState = state;
        toggleStopButton(workingState === 'asking');
        $('#working-state').text(workingState === 'asking' ? 'Thinking...' : '');
    }
    function toggleStopButton(enabled) {
        const button = $('#stop-button');
        if (enabled) {
            button.prop('disabled', false)
                .removeClass('cursor-not-allowed')
                .addClass('bg-red-600 hover:bg-red-700');
        }
        else {
            button.prop('disabled', true)
                .removeClass('bg-red-600 hover:bg-red-700')
                .addClass('cursor-not-allowed');
        }
    }
    // Function to send a message to the extension
    function sendMessage(value) {
        vscode.postMessage({
            type: 'sendPrompt',
            value: {
                task: value,
                context: $('#context-select').val()
            }
        });
    }
    // vscode.postMessage({ type: 'webviewLoaded' });
    $(document).ready(function () {
        // Listen for keyup events on the prompt input element
        const promptInput = $('#prompt-input');
        promptInput.on('keyup', (e) => {
            // If the key combination that was pressed was Ctrl+Enter
            if (e.keyCode === 13 && e.ctrlKey) {
                sendMessage(promptInput.val());
            }
        });
        const sendButton = $('#send-request');
        sendButton.on('click', () => {
            sendMessage(promptInput.val());
        });
        // Listen for click events on the stop button
        $('#stop-button').on('click', () => {
            vscode.postMessage({
                type: 'abort'
            });
        });
        // Listen for click events on the reset button and send message resetConversation
        $('#reset-button').on('click', () => {
            vscode.postMessage({
                type: 'resetConversation'
            });
        });
        $('#prompt-input').autocomplete({
            position: { my: "left bottom", at: "left top" },
            source: function (request, response) {
                // if cachedPrompts is empty, postMessage 'loadPrompts'
                if (cachedPrompts.length === 0) {
                    vscode.postMessage({ type: 'loadPrompts' });
                    return;
                }
                const searchTerm = request.term.toLowerCase(); // convert search term to lowercase
                const matches = $.grep(cachedPrompts, function (item) {
                    return item.toLowerCase().indexOf(searchTerm) >= 0; // convert item to lowercase before comparing
                });
                response(matches);
            }
        });
        vscode.postMessage({ type: 'webviewLoaded' });
    });
})();
//# sourceMappingURL=main.js.map