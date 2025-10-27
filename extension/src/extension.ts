import * as vscode from 'vscode';

import { CodeSuggester } from './codeSuggester';
//import { CodeCompletionProvider } from './providers/codeCompletionProvider';
import { CodeInlineCompletionProvider } from './providers/codeInlineCompletionProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Code Suggester extension activated');

    const suggester = new CodeSuggester(context);

    // Simple suggestions (Ctrl+Space)
    // const completionProvider = vscode.languages.registerCompletionItemProvider(
    //     { pattern: '**/*.{cs,js,ts,py}' },
    //     new CodeCompletionProvider(suggester),
    //     '.', ' ', '(', '=', '{', '[', ':' // Триггерные символы
    // );

    // Inline suggestions (Tab-autocomplete)
    const inlineProvider = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**/*.{cs,js,ts,py,vue}' },
        new CodeInlineCompletionProvider(suggester)
    );

    // Commands
    const reloadCommand = vscode.commands.registerCommand('codeSuggester.reloadModel', async () => {
        vscode.window.showInformationMessage('Reloading code suggestion model...');
        await suggester.reloadModel();
        vscode.window.showInformationMessage('Code suggestion model reloaded!');
    });

    const statusCommand = vscode.commands.registerCommand('codeSuggester.showStatus', () => {
        if (suggester.isModelLoaded) {
            const languages = suggester.model?.file_extensions.join(', ') || 'unknown';
            const projectStats = suggester.getProjectContextStats();
            vscode.window.showInformationMessage(
                `Code suggestion model is loaded for languages: ${languages}. ` +
                `Project context: ${projectStats.files} files (${projectStats.extensions.join(', ')})`
            );
        } else {
            vscode.window.showWarningMessage('Code suggestion model is not loaded');
        }
    });

    const clearProjectContextCommand = vscode.commands.registerCommand('codeSuggester.clearProjectContext', () => {
        suggester.clearProjectContext();
        vscode.window.showInformationMessage('Project context cleared!');
    });

    const reloadProjectContextCommand = vscode.commands.registerCommand('codeSuggester.reloadProjectContext', () => {
        suggester.clearProjectContext(); // clear and reload will happen automatically
        vscode.window.showInformationMessage('Project context reloaded from open files!');
    });

    context.subscriptions.push(
        inlineProvider, 
        reloadCommand, 
        statusCommand,
        clearProjectContextCommand,
        reloadProjectContextCommand
    );
}

export function deactivate() {
    // Cleanup
}
