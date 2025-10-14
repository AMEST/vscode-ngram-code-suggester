import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';

interface Suggestion {
    token: string;
    confidence: number;
}

interface CodeModel {
    version: string;
    n: number;
    ngrams: { 
        [extension: string]: { 
            [context: string]: { [token: string]: number } 
        } 
    };
    file_extensions: string[];
    total_patterns: number;
}

// Маппинг расширений файлов на языки
const LANGUAGE_EXTENSIONS: { [key: string]: string[] } = {
    '.cs': ['.cs'],
    '.js': ['.js'],
    '.ts': ['.ts', '.tsx'],
    '.py': ['.py']
};

const EXTENSION_TO_LANGUAGE: { [key: string]: string } = {
    '.cs': '.cs',
    '.js': '.js', 
    '.ts': '.ts',
    '.tsx': '.ts',
    '.py': '.py'
};

export class CodeSuggester {
    public model: CodeModel | null = null;
    public isModelLoaded: boolean = false;

    constructor(private context: vscode.ExtensionContext) {
        this.loadModel();
    }

    private async loadModel() {
        const config = vscode.workspace.getConfiguration('codeSuggester');
        const modelPath = config.get('modelPath') as string;
        
        if (!modelPath) {
            console.log('Model path not configured');
            return;
        }

        try {
            const fullModelPath = this.resolveModelPath(modelPath);
            if (!fullModelPath || !fs.existsSync(fullModelPath)) {
                console.log('Model file not found:', fullModelPath);
                return;
            }

            const modelData = await this.readModelFile(fullModelPath);
            this.model = modelData;
            this.isModelLoaded = true;
            
            console.log(`Code suggestion model loaded: ${this.model.total_patterns} patterns for ${this.model.file_extensions.length} languages`);
            
        } catch (error) {
            console.error('Error loading model:', error);
            vscode.window.showErrorMessage(`Failed to load code suggestion model: ${error}`);
        }
    }

    private resolveModelPath(modelPath: string): string | null {
        if (path.isAbsolute(modelPath)) {
            return modelPath;
        }

        // Пробуем найти относительно workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspacePath = workspaceFolders[0].uri.fsPath;
            const fullPath = path.join(workspacePath, modelPath);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }

        // Пробуем найти относительно расширения
        const extensionPath = this.context.extensionPath;
        const extensionModelPath = path.join(extensionPath, modelPath);
        if (fs.existsSync(extensionModelPath)) {
            return extensionModelPath;
        }

        return null;
    }

    private async readModelFile(filepath: string): Promise<CodeModel> {
        return new Promise((resolve, reject) => {
            fs.readFile(filepath, (err, data) => {
                if (err) {
                    reject(err);
                    return;
                }

                const isCompressed = data.length >= 2 && data[0] === 0x1F && data[1] === 0x8B;

                if (isCompressed) {
                    zlib.gunzip(data, (err, decompressed) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        try {
                            const model = JSON.parse(decompressed.toString('utf-8'));
                            resolve(model);
                        } catch (parseErr) {
                            reject(parseErr);
                        }
                    });
                } else {
                    try {
                        const model = JSON.parse(data.toString('utf-8'));
                        resolve(model);
                    } catch (parseErr) {
                        reject(parseErr);
                    }
                }
            });
        });
    }

    public getSuggestions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        if (!this.isModelLoaded || !this.model) {
            return [];
        }

        const fileExtension = this.getFileExtension(document);
        const languageExtensions = this.getLanguageExtensions(fileExtension);
        
        if (!languageExtensions) {
            return []; // Язык не поддерживается
        }

        const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const suggestions = this.generateSuggestions(text, languageExtensions);
        
        return suggestions.map((suggestion, index) => {
            const item = new vscode.CompletionItem(
                suggestion.token, 
                vscode.CompletionItemKind.Text
            );
            item.detail = `Confidence: ${(suggestion.confidence * 100).toFixed(1)}%`;
            item.sortText = index.toString().padStart(5, '0');
            item.insertText = suggestion.token;
            return item;
        });
    }

    private getFileExtension(document: vscode.TextDocument): string {
        const fileName = document.fileName;
        return path.extname(fileName).toLowerCase();
    }

    private getLanguageExtensions(fileExtension: string): string[] | null {
        // Находим основной язык для этого расширения
        const mainExtension = EXTENSION_TO_LANGUAGE[fileExtension];
        if (!mainExtension) {
            return null;
        }

        // Возвращаем все расширения для этого языка
        return LANGUAGE_EXTENSIONS[mainExtension] || [mainExtension];
    }

    private generateSuggestions(currentText: string, languageExtensions: string[]): Suggestion[] {
        if (!this.model) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('codeSuggester');
        const maxSuggestions = config.get('maxSuggestions') as number;
        const minConfidence = config.get('minConfidence') as number;

        try {
            const tokens = this.tokenizeText(currentText);
            if (tokens.length < this.model.n - 1) {
                return [];
            }

            const context = tokens.slice(-(this.model.n - 1));
            const contextKey = JSON.stringify(context);

            const matches: Suggestion[] = [];
            
            // Ищем только среди данных для нужных языков
            for (const ext of languageExtensions) {
                const languageData = this.model.ngrams[ext];
                if (!languageData) {
                    continue; // Нет данных для этого языка
                }

                // Точные совпадения для этого языка
                if (languageData[contextKey]) {
                    const nextTokens = languageData[contextKey];
                    const total = Object.values(nextTokens).reduce((sum, count) => sum + count, 0);
                    
                    for (const [token, count] of Object.entries(nextTokens)) {
                        const confidence = count / total;
                        matches.push({ token, confidence });
                    }
                }

                // Fuzzy search для этого языка
                for (const [storedContextKey, nextTokens] of Object.entries(languageData)) {
                    if (storedContextKey === contextKey) {
                        continue; // Уже обработали точные совпадения
                    }

                    const storedContext = JSON.parse(storedContextKey);
                    const similarity = this.calculateSimilarity(context, storedContext);
                    
                    if (similarity >= minConfidence) {
                        const total = Object.values(nextTokens).reduce((sum, count) => sum + count, 0);
                        
                        for (const [token, count] of Object.entries(nextTokens)) {
                            const confidence = similarity * (count / total);
                            matches.push({ token, confidence });
                        }
                    }
                }
            }

            // Сортируем и фильтруем
            return matches
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, maxSuggestions);

        } catch (error) {
            console.error('Error generating suggestions:', error);
            return [];
        }
    }

    private tokenizeText(text: string): string[] {
        const tokens: string[] = [];
        const lines = text.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            
            const lineTokens = trimmed.match(
                /[a-zA-Z_][a-zA-Z0-9_]*|[0-9.]+|[+\-*/=<>!&|^~%]+|[:;,\.\(\)\[\]\{\}]|".*?"|'.*?'/g
            ) || [];
            
            tokens.push(...lineTokens);
        }
        
        return tokens;
    }

    private calculateSimilarity(tokens1: string[], tokens2: string[]): number {
        if (tokens1.length !== tokens2.length) {
            return 0;
        }
        
        let matches = 0;
        for (let i = 0; i < tokens1.length; i++) {
            if (tokens1[i] === tokens2[i]) {
                matches++;
            }
        }
        
        return matches / tokens1.length;
    }

    public async reloadModel() {
        this.model = null;
        this.isModelLoaded = false;
        await this.loadModel();
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Code Suggester extension activated');
    
    const suggester = new CodeSuggester(context);
    
    const provider = vscode.languages.registerCompletionItemProvider(
        { pattern: '**/*.{cs,js,ts,py}' },
        {
            provideCompletionItems: (document: vscode.TextDocument, position: vscode.Position) => {
                return suggester.getSuggestions(document, position);
            }
        },
        '.', ' ', '(', '=', '{', '[', ':' // Триггерные символы
    );
    
    const reloadCommand = vscode.commands.registerCommand('codeSuggester.reloadModel', async () => {
        vscode.window.showInformationMessage('Reloading code suggestion model...');
        await suggester.reloadModel();
        vscode.window.showInformationMessage('Code suggestion model reloaded!');
    });

    const statusCommand = vscode.commands.registerCommand('codeSuggester.showStatus', () => {
        if (suggester.isModelLoaded) {
            const languages = suggester.model?.file_extensions.join(', ') || 'unknown';
            vscode.window.showInformationMessage(`Code suggestion model is loaded for languages: ${languages}`);
        } else {
            vscode.window.showWarningMessage('Code suggestion model is not loaded');
        }
    });
    
    context.subscriptions.push(provider, reloadCommand, statusCommand);
}

export function deactivate() {
    // Cleanup
}