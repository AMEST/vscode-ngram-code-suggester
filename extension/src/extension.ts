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
    vocab?: { [extension: string]: string[] };
    file_extensions: string[];
    total_patterns: number;
    smoothing?: string;
    alpha?: number;
}

const LANGUAGE_EXTENSIONS: { [key: string]: string[] } = {
    '.cs': ['.cs', '.cshtml'],
    '.js': ['.js', '.vue'],
    '.ts': ['.ts', '.tsx'],
    '.py': ['.py']
};

const EXTENSION_TO_LANGUAGE: { [key: string]: string } = {
    '.cs': '.cs',
    '.cshtml': '.cs',
    '.js': '.js',
    '.vue': '.js',
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
            vscode.window.showWarningMessage(`Model path not configured`);
            return;
        }

        try {
            const fullModelPath = this.resolveModelPath(modelPath);
            if (!fullModelPath || !fs.existsSync(fullModelPath)) {
                console.log('Model file not found:', fullModelPath);
                vscode.window.showWarningMessage(`Model file not found: ${fullModelPath}`);
                return;
            }

            const modelData = await this.readModelFile(fullModelPath);
            this.model = modelData;
            this.isModelLoaded = true;

            console.log(`Code suggestion model loaded: ${this.model.total_patterns} patterns for ${this.model.file_extensions.length} languages`);
            vscode.window.showInformationMessage(`Code suggestion model loaded: ${this.model.total_patterns} patterns for ${this.model.file_extensions.length} languages`);

        } catch (error) {
            console.error('Error loading model:', error);
            vscode.window.showErrorMessage(`Failed to load code suggestion model: ${error}`);
        }
    }

    private resolveModelPath(modelPath: string): string | null {
        if (path.isAbsolute(modelPath)) {
            return modelPath;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspacePath = workspaceFolders[0].uri.fsPath;
            const fullPath = path.join(workspacePath, modelPath);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }

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

    // 🔄 ОРИГИНАЛЬНЫЙ COMPLETION PROVIDER (для Ctrl+Space)
    public getSuggestions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        if (!this.isModelLoaded || !this.model) {
            return [];
        }

        const fileExtension = this.getFileExtension(document);
        const languageExtensions = this.getLanguageExtensions(fileExtension);

        if (!languageExtensions) {
            return [];
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

    // 🆕 INLINE SUGGESTION PROVIDER (для Tab-дополнений)
    public getInlineSuggestions(document: vscode.TextDocument, position: vscode.Position): vscode.InlineCompletionItem[] {
        if (!this.isModelLoaded || !this.model) {
            return [];
        }

        const fileExtension = this.getFileExtension(document);
        const languageExtensions = this.getLanguageExtensions(fileExtension);

        if (!languageExtensions) {
            return [];
        }

        const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const suggestions = this.generateSuggestions(text, languageExtensions);

        if (suggestions.length === 0) {
            return [];
        }

        // Берем топ-1 предложение для inline отображения
        const topSuggestion = suggestions[0];

        return [
            new vscode.InlineCompletionItem(
                topSuggestion.token,
                new vscode.Range(position, position)
            )
        ];
    }

    private getFileExtension(document: vscode.TextDocument): string {
        const fileName = document.fileName;
        return path.extname(fileName).toLowerCase();
    }

    private getLanguageExtensions(fileExtension: string): string[] | null {
        const mainExtension = EXTENSION_TO_LANGUAGE[fileExtension];
        if (!mainExtension) {
            return null;
        }
        return LANGUAGE_EXTENSIONS[mainExtension] || [mainExtension];
    }

    private generateSuggestions(currentText: string, languageExtensions: string[]): Suggestion[] {
        if (!this.model) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('codeSuggester');
        const maxSuggestions = config.get('maxSuggestions') as number;
        let minConfidence = config.get('minConfidence') as number;
        const useSmoothing = config.get('useSmoothing') as boolean;

        // Автоматическая настройка порогов для разных режимов
        if (useSmoothing && this.model.smoothing && this.model.smoothing !== 'none') {
            minConfidence = Math.max(minConfidence * 0.3, 0.05); // 30% от оригинального порога, но не менее 0.05
        }

        try {
            const tokens = this.tokenizeText(currentText);
            if (tokens.length < this.model.n - 1) {
                return [];
            }

            const shouldUseSmoothing = useSmoothing &&
                this.model.smoothing &&
                this.model.smoothing !== 'none' &&
                this.model.vocab;

            if (shouldUseSmoothing) {
                return this.generateSuggestionsWithSmoothing(tokens, languageExtensions, maxSuggestions, minConfidence);
            } else {
                return this.generateSuggestionsClassic(tokens, languageExtensions, maxSuggestions, minConfidence);
            }

        } catch (error) {
            console.error('Error generating suggestions:', error);
            return [];
        }
    }

    private generateSuggestionsWithSmoothing(
        tokens: string[],
        languageExtensions: string[],
        maxSuggestions: number,
        minConfidence: number
    ): Suggestion[] {
        if (!this.model || !this.model.vocab) {
            return [];
        }

        const context = tokens.slice(-(this.model.n - 1));
        const contextKey = JSON.stringify(context).replaceAll('","', '", "'); // replace for fix serialization between python and js
        const matches: Suggestion[] = [];
        const usedTokens = new Set<string>();

        // 1. Точные совпадения контекста
        for (const ext of languageExtensions) {
            const languageData = this.model.ngrams[ext];
            if (!languageData) {
                continue;
            }

            if (languageData[contextKey]) {
                const nextTokens = languageData[contextKey];
                const total = Object.values(nextTokens).reduce((sum, count) => sum + count, 0);

                for (const [token, count] of Object.entries(nextTokens)) {
                    const confidence = count / total;
                    if (confidence >= minConfidence && !usedTokens.has(token)) {
                        matches.push({ token, confidence });
                        usedTokens.add(token);
                    }
                }
            }
        }

        // 2. Fuzzy Search (нечеткий поиск) - ВОЗВРАЩАЕМ ЭТОТ ПОДХОД
        for (const ext of languageExtensions) {
            const languageData = this.model.ngrams[ext];
            if (!languageData) {
                continue;
            }

            for (const [storedContextKey, nextTokens] of Object.entries(languageData)) {
                if (storedContextKey === contextKey) {
                    continue; // Уже обработали в точных совпадениях
                }

                const storedContext = JSON.parse(storedContextKey);
                const similarity = this.calculateSimilarity(context, storedContext);

                // Используем более низкий порог для fuzzy search в режиме сглаживания
                const fuzzyThreshold = minConfidence * 0.7;
                if (similarity >= fuzzyThreshold) {
                    const total = Object.values(nextTokens).reduce((sum, count) => sum + count, 0);

                    for (const [token, count] of Object.entries(nextTokens)) {
                        const confidence = similarity * (count / total);
                        // Более низкий порог для fuzzy результатов
                        if (confidence >= fuzzyThreshold && !usedTokens.has(token)) {
                            matches.push({ token, confidence });
                            usedTokens.add(token);
                        }
                    }
                }
                if (matches.length > maxSuggestions * 35) // Ограничитель, чтобы не искать прям все. Качество скорее всего ухудшится, но скорость должна улучшиться
                    break;
            }
        }

        // 3. Сглаживание Лапласа только если предыдущие методы не дали результатов
        if (matches.length < maxSuggestions) {
            const remainingSlots = maxSuggestions - matches.length;
            const smoothedSuggestions = this.getSmoothedSuggestions(
                context,
                languageExtensions,
                remainingSlots,
                minConfidence * 0.5, // Еще более низкий порог для сглаживания
                usedTokens
            );
            matches.push(...smoothedSuggestions);
        }

        return matches
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, maxSuggestions);
    }

    private getSmoothedSuggestions(
        context: string[],
        languageExtensions: string[],
        maxSlots: number,
        minConfidence: number,
        usedTokens: Set<string>
    ): Suggestion[] {
        if (!this.model || !this.model.vocab) {
            return [];
        }

        const matches: Suggestion[] = [];
        const contextKey = JSON.stringify(context).replaceAll('","', '", "'); // replace for fix serialization between python and js

        for (const ext of languageExtensions) {
            if (matches.length >= maxSlots) break;

            const languageData = this.model.ngrams[ext];
            const vocab = this.model.vocab[ext];
            if (!languageData || !vocab) {
                continue;
            }

            const contextCounts = languageData[contextKey] || {};
            const totalCount = Object.values(contextCounts).reduce((sum, count) => sum + count, 0);
            const vocabSize = vocab.length;
            const alpha = this.model.alpha || 0.1;

            // Если контекст не найден, используем общую частоту токенов
            if (totalCount === 0) {
                const globalFreq = this.calculateGlobalTokenFrequency(languageData);
                const globalTotal = Object.values(globalFreq).reduce((sum, count) => sum + count, 0);

                for (const [token, count] of Object.entries(globalFreq)) {
                    if (matches.length >= maxSlots) break;
                    if (usedTokens.has(token)) continue;

                    const confidence = count / globalTotal;
                    if (confidence >= minConfidence) {
                        matches.push({ token, confidence });
                        usedTokens.add(token);
                    }
                }
            } else {
                // Контекст найден - используем сглаживание Лапласа
                for (const token of vocab) {
                    if (matches.length >= maxSlots) break;
                    if (usedTokens.has(token)) continue;

                    const tokenCount = contextCounts[token] || 0;
                    const probability = (tokenCount + alpha) / (totalCount + alpha * vocabSize);

                    if (probability >= minConfidence) {
                        matches.push({ token, confidence: probability });
                        usedTokens.add(token);
                    }
                }
            }
        }

        return matches;
    }

    private calculateGlobalTokenFrequency(languageData: any): { [token: string]: number } {
        const frequency: { [token: string]: number } = {};

        for (const contextData of Object.values(languageData)) {
            for (const [token, count] of Object.entries(contextData as { [token: string]: number })) {
                frequency[token] = (frequency[token] || 0) + (count as number);
            }
        }

        return frequency;
    }

    private generateSuggestionsClassic(
        tokens: string[],
        languageExtensions: string[],
        maxSuggestions: number,
        minConfidence: number): Suggestion[] {
        if (!this.model) {
            return [];
        }

        try {
            const context = tokens.slice(-(this.model.n - 1));
            const contextKey = JSON.stringify(context);

            const matches: Suggestion[] = [];

            for (const ext of languageExtensions) {
                const languageData = this.model.ngrams[ext];
                if (!languageData) {
                    continue;
                }

                if (languageData[contextKey]) {
                    const nextTokens = languageData[contextKey];
                    const total = Object.values(nextTokens).reduce((sum, count) => sum + count, 0);

                    for (const [token, count] of Object.entries(nextTokens)) {
                        const confidence = count / total;
                        matches.push({ token, confidence });
                    }
                }

                for (const [storedContextKey, nextTokens] of Object.entries(languageData)) {
                    if (storedContextKey === contextKey) {
                        continue;
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
        const minLength = Math.min(tokens1.length, tokens2.length);
        if (minLength === 0) {
            return 0;
        }

        let matches = 0;
        // Сравниваем с конца (самый релевантный контекст)
        for (let i = 1; i <= minLength; i++) {
            if (tokens1[tokens1.length - i] === tokens2[tokens2.length - i]) {
                matches++;
            }
        }

        // Взвешиваем похожесть - последние токены более важны
        const baseSimilarity = matches / minLength;
        const positionWeight = matches > 0 ? 1.0 : 0; // Дополнительный вес если есть совпадения

        return baseSimilarity * positionWeight;
    }

    public async reloadModel() {
        this.model = null;
        this.isModelLoaded = false;
        await this.loadModel();
    }
}

// 🔄 REGULAR COMPLETION PROVIDER
class CodeCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private suggester: CodeSuggester) { }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        return this.suggester.getSuggestions(document, position);
    }
}

// 🆕 INLINE COMPLETION PROVIDER  
class CodeInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    constructor(private suggester: CodeSuggester) { }

    provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
        return this.suggester.getInlineSuggestions(document, position);
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Code Suggester extension activated');

    const suggester = new CodeSuggester(context);

    // 🔄 Обычные подсказки (Ctrl+Space)
    // const completionProvider = vscode.languages.registerCompletionItemProvider(
    //     { pattern: '**/*.{cs,js,ts,py}' },
    //     new CodeCompletionProvider(suggester),
    //     '.', ' ', '(', '=', '{', '[', ':' // Триггерные символы
    // );

    // 🆕 Inline подсказки (Tab-дополнения)
    const inlineProvider = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**/*.{cs,js,ts,py,vue}' },
        new CodeInlineCompletionProvider(suggester)
    );

    // Команды
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

    context.subscriptions.push(inlineProvider, reloadCommand, statusCommand);
}

export function deactivate() {
    // Cleanup
}