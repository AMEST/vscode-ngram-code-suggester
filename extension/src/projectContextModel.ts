import * as vscode from 'vscode';
import * as path from 'path';
import { EXTENSION_TO_LANGUAGE } from './utils/constants'
import { tokenizeText } from './utils/utils';
import { Suggestion } from './interfaces/suggestion';

export class ProjectContextModel {
    private n: number;
    private projectNgrams: {
        [extension: string]: {
            [context: string]: { [token: string]: number }
        }
    };
    private fileContents: Map<string, string[]>; // fileName -> tokens

    constructor(n: number) {
        this.n = n;
        this.projectNgrams = {};
        this.fileContents = new Map();
    }

    public addDocument(document: vscode.TextDocument) {
        const fileExtension = this.getFileExtension(document.fileName);
        if (!this.isSupportedExtension(fileExtension)) {
            return;
        }

        const text = document.getText();
        const tokens = tokenizeText(text);
        
        // Save file tokens
        this.fileContents.set(document.fileName, tokens);
        
        // Update n-gram model
        this.updateNgramsForFile(fileExtension, tokens);
    }

    public removeDocument(document: vscode.TextDocument) {
        const fileName = document.fileName;
        
        if (this.fileContents.has(fileName)) {
            // Remove file from model
            this.fileContents.delete(fileName);
            
            // Rebuild project context model
            this.rebuildProjectModel();
        }
    }

    public updateDocument(document: vscode.TextDocument) {
        // When a file changes, we rebuild its n-grams
        this.removeDocument(document);
        this.addDocument(document);
    }

    private rebuildProjectModel() {
        // Clear current model
        this.projectNgrams = {};

        // Rebuild from all open files
        for (const [fileName, tokens] of this.fileContents.entries()) {
            const fileExtension = this.getFileExtension(fileName);
            this.updateNgramsForFile(fileExtension, tokens);
        }
    }

    private updateNgramsForFile(extension: string, tokens: string[]) {
        if (!this.projectNgrams[extension]) {
            this.projectNgrams[extension] = {};
        }

        // Building n-grams for a file
        for (let i = 0; i <= tokens.length - this.n; i++) {
            const contextTokens = tokens.slice(i, i + this.n - 1);
            const nextToken = tokens[i + this.n - 1];
            
            const contextKey = JSON.stringify(contextTokens).replaceAll('","', '", "');
            
            if (!this.projectNgrams[extension][contextKey]) {
                this.projectNgrams[extension][contextKey] = {};
            }
            
            this.projectNgrams[extension][contextKey][nextToken] = 
                (this.projectNgrams[extension][contextKey][nextToken] || 0) + 1;
        }
    }

    public generateProjectSuggestions(
        context: string[], 
        languageExtensions: string[], 
        maxSuggestions: number, 
        minConfidence: number
    ): Suggestion[] {
        if (context.length < this.n - 1) {
            return [];
        }

        const contextKey = JSON.stringify(context.slice(-(this.n - 1))).replaceAll('","', '", "');
        const matches: Suggestion[] = [];

        for (const ext of languageExtensions) {
            const languageData = this.projectNgrams[ext];
            if (!languageData || !languageData[contextKey]) {
                continue;
            }

            const nextTokens = languageData[contextKey];
            const total = Object.values(nextTokens).reduce((sum, count) => sum + count, 0);

            for (const [token, count] of Object.entries(nextTokens)) {
                const confidence = count / total;
                if (confidence >= minConfidence) {
                    matches.push({ 
                        token, 
                        confidence: confidence * 0.8, // Slightly reducing the confidence of project hints
                        source: 'project'
                    });
                }
            }
        }

        return matches
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, maxSuggestions);
    }

    public getProjectStats(): { files: number; extensions: string[] } {
        const extensions = new Set<string>();
        for (const fileName of this.fileContents.keys()) {
            extensions.add(this.getFileExtension(fileName));
        }
        return {
            files: this.fileContents.size,
            extensions: Array.from(extensions)
        };
    }

    public clear() {
        this.projectNgrams = {};
        this.fileContents.clear();
    }

    private getFileExtension(fileName: string): string {
        return path.extname(fileName).toLowerCase();
    }

    private isSupportedExtension(extension: string): boolean {
        return Object.keys(EXTENSION_TO_LANGUAGE).includes(extension);
    }
}