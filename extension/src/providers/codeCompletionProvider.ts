import * as vscode from 'vscode';

import { CodeSuggester } from '../codeSuggester';

// 🔄 REGULAR COMPLETION PROVIDER
export class CodeCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private suggester: CodeSuggester) { }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        return this.suggester.getSuggestions(document, position);
    }
}