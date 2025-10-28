import * as vscode from 'vscode';

import { CodeSuggester } from '../codeSuggester';


// 🆕 INLINE COMPLETION PROVIDER  
export class CodeInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    constructor(private suggester: CodeSuggester) { }

    provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
        const config = vscode.workspace.getConfiguration('codeSuggester');
        const useTriggerCharacters = config.get('useTriggerCharacters') as boolean;

        if (!useTriggerCharacters)
            return this.suggester.getInlineSuggestions(document, position);

        const triggerCharacters = new Set(['.', ',', ' ', '(', ')', '=', '{', '[', ':', ';']);

        // Get the character before the cursor
        const line = document.lineAt(position.line).text;
        const charBeforeCursor = line[position.character - 1];

        // Return empty array if character is not in trigger set
        if (!charBeforeCursor || !triggerCharacters.has(charBeforeCursor)) {
            return [];
        }

        return this.suggester.getInlineSuggestions(document, position);
    }
}
