import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';

import { LANGUAGE_EXTENSIONS, EXTENSION_TO_LANGUAGE } from './utils/constants'
import { tokenizeText, calculateSimilarity, calculateGlobalTokenFrequency } from './utils/utils';
import { Suggestion } from './interfaces/suggestion';
import { CodeModel } from './interfaces/codeModel';
import { ProjectContextModel } from './projectContextModel';

export class CodeSuggester {
    public model: CodeModel | null = null;
    public isModelLoaded: boolean = false;
    public projectModel: ProjectContextModel;
    private documentListeners: vscode.Disposable[] = [];

    constructor(private context: vscode.ExtensionContext) {
        this.projectModel = new ProjectContextModel(3); // Default n=3. After model loaded, it's updated via model N
        this.loadModel();
        this.setupDocumentListeners();
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
            // Update N in project model
            this.projectModel = new ProjectContextModel(this.model.n);

            console.log(`Code suggestion model loaded: ${this.model.total_patterns} patterns for ${this.model.file_extensions.length} languages`);
            vscode.window.showInformationMessage(`Code suggestion model loaded: ${this.model.total_patterns} patterns for ${this.model.file_extensions.length} languages`);

        } catch (error) {
            console.error('Error loading model:', error);
            vscode.window.showErrorMessage(`Failed to load code suggestion model: ${error}`);
        }
    }

    private setupDocumentListeners() {
        // Handle current opened files
        vscode.workspace.textDocuments.forEach(document => {
            this.projectModel.addDocument(document);
        });

        // Listen open files events
        const openDisposable = vscode.workspace.onDidOpenTextDocument(document => {
            const config = vscode.workspace.getConfiguration('codeSuggester');
            if (config.get('useProjectContext') as boolean) {
                this.projectModel.addDocument(document);
            }
        });

        // Listen file close events
        const closeDisposable = vscode.workspace.onDidCloseTextDocument(document => {
            const config = vscode.workspace.getConfiguration('codeSuggester');
            if (config.get('useProjectContext') as boolean) {
                this.projectModel.removeDocument(document);
            }
        });

        // Listen file updates events
        const changeDisposable = vscode.workspace.onDidChangeTextDocument(event => {
            const config = vscode.workspace.getConfiguration('codeSuggester');
            if (config.get('useProjectContext') as boolean && config.get('updateOnFileChange') as boolean) {
                this.projectModel.updateDocument(event.document);
            }
        });

        this.documentListeners.push(openDisposable, closeDisposable, changeDisposable);
    }

    private resolveModelPath(modelPath: string): string | null {
        if (path.isAbsolute(modelPath))
            return modelPath;

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspacePath = workspaceFolders[0].uri.fsPath;
            const fullPath = path.join(workspacePath, modelPath);
            if (fs.existsSync(fullPath))
                return fullPath;
        }

        const extensionPath = this.context.extensionPath;
        const extensionModelPath = path.join(extensionPath, modelPath);
        if (fs.existsSync(extensionModelPath))
            return extensionModelPath;

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

    // COMPLETION PROVIDER (Ctrl+Space suggestion)
    public getSuggestions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        if (!this.isModelLoaded || !this.model)
            return [];

        const fileExtension = this.getFileExtension(document);
        const languageExtensions = this.getLanguageExtensions(fileExtension);

        if (!languageExtensions)
            return [];

        const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const suggestions = this.generateCombinedSuggestions(text, languageExtensions, document);

        const shouldAddSpace = this.shouldAddSpaceBeforeSuggestion(document, position);

        return suggestions.map((suggestion, index) => {
            const item = new vscode.CompletionItem(
                suggestion.token,
                vscode.CompletionItemKind.Text
            );
            const sourceLabel = suggestion.source === 'project' ? '🔄 Project' : '🌍 Global';
            item.detail = `${sourceLabel} • Confidence: ${(suggestion.confidence * 100).toFixed(1)}%`;
            item.sortText = (suggestion.source === 'project' ? 'A' : 'B') + index.toString().padStart(5, '0');
            item.insertText = shouldAddSpace ? ` ${suggestion.token}` : suggestion.token;

            if (suggestion.source === 'project') {
                item.label = `$(project) ${suggestion.token}`;
            }
            return item;
        });
    }

    // INLINE SUGGESTION PROVIDER (Tab-autocompletion)
    public getInlineSuggestions(document: vscode.TextDocument, position: vscode.Position): vscode.InlineCompletionItem[] {
        if (!this.isModelLoaded || !this.model) {
            return [];
        }

        const fileExtension = this.getFileExtension(document);
        const languageExtensions = this.getLanguageExtensions(fileExtension);

        if (!languageExtensions)
            return [];

        const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const suggestions = this.generateCombinedSuggestions(text, languageExtensions, document);

        if (suggestions.length === 0)
            return [];

        const shouldAddSpace = this.shouldAddSpaceBeforeSuggestion(document, position);

        return suggestions.map(suggestion =>
            new vscode.InlineCompletionItem(
                shouldAddSpace ? ` ${suggestion.token}` : suggestion.token,
                new vscode.Range(position, position)
            )
        );
    }

    private generateCombinedSuggestions(
        currentText: string,
        languageExtensions: string[],
        document?: vscode.TextDocument
    ): Suggestion[] {
        const config = vscode.workspace.getConfiguration('codeSuggester');
        const useProjectContext = config.get('useProjectContext') as boolean;
        const maxSuggestions = config.get('maxSuggestions') as number;
        let minConfidence = config.get('minConfidence') as number;

        const tokens = tokenizeText(currentText);
        if (tokens.length < (this.model ? this.model.n - 1 : 2)) {
            return [];
        }

        let globalSuggestions: Suggestion[] = [];
        let projectSuggestions: Suggestion[] = [];

        // Generate global suggestion
        if (this.model) {
            const useSmoothing = config.get('useSmoothing') as boolean;
            const enableFuzzyMatching = config.get('enableFuzzyMatching') as boolean;
            const maxFuzzyChecks = config.get('maxFuzzyChecks', 1000);

            if (useSmoothing && this.model.smoothing && this.model.smoothing !== 'none') {
                minConfidence = Math.max(minConfidence * 0.3, 0.05);
            }

            globalSuggestions = this.generateSuggestions(
                tokens,
                languageExtensions,
                maxSuggestions,
                minConfidence,
                enableFuzzyMatching,
                maxFuzzyChecks,
                Boolean(useSmoothing && this.model.smoothing && this.model.smoothing !== 'none')
            );

            // fill suggest source
            globalSuggestions = globalSuggestions.map(s => ({ ...s, source: 'global' as const }));
        }

        // Generate project context suggestions. if enabled
        if (useProjectContext && document) {
            const projectMinConfidence = Math.max(minConfidence * 0.7, 0.02);// Less min confidence for project suggestions
            projectSuggestions = this.projectModel.generateProjectSuggestions(
                tokens,
                languageExtensions,
                maxSuggestions,
                projectMinConfidence
            );
        }

        // Concat and sort suggestions
        const allSuggestions = [...globalSuggestions, ...projectSuggestions];
        // Deduplicate suggestion and save suggestion with max confidence
        const uniqueSuggestions = this.deduplicateSuggestions(allSuggestions);

        return uniqueSuggestions
            .sort((a, b) => {
                if (Math.abs(b.confidence - a.confidence) > 0.05) {
                    return b.confidence - a.confidence;
                }
                if (a.source !== b.source) {
                    return a.source === 'project' ? -1 : 1;
                }
                return 0;
            })
            .slice(0, maxSuggestions);
    }

    private deduplicateSuggestions(suggestions: Suggestion[]): Suggestion[] {
        const seen = new Map<string, Suggestion>();

        for (const suggestion of suggestions) {
            const existing = seen.get(suggestion.token);
            if (!existing || existing.confidence < suggestion.confidence) {
                seen.set(suggestion.token, suggestion);
            }
        }

        return Array.from(seen.values());
    }

    private getFileExtension(document: vscode.TextDocument): string {
        const fileName = document.fileName;
        return path.extname(fileName).toLowerCase();
    }

    private getLanguageExtensions(fileExtension: string): string[] | null {
        const mainExtension = EXTENSION_TO_LANGUAGE[fileExtension];
        if (!mainExtension)
            return null;
        return LANGUAGE_EXTENSIONS[mainExtension] || [mainExtension];
    }

    private generateSuggestions(
        tokens: string[],
        languageExtensions: string[],
        maxSuggestions: number,
        minConfidence: number,
        enableFuzzyMatching: boolean,
        maxFuzzyChecks: number,
        useSmoothing: boolean = false
    ): Suggestion[] {
        if (!this.model)
            return [];

        const context = tokens.slice(-(this.model.n - 1));
        const contextKey = JSON.stringify(context).replaceAll('","', '", "');// replace for fix serialization between python and js
        const matches: Suggestion[] = [];
        const usedTokens = new Set<string>();

        // Exact matches
        for (const ext of languageExtensions) {
            const languageData = this.model.ngrams[ext];
            if (!languageData)
                continue;

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

        // Fuzzy matches
        if (enableFuzzyMatching && matches.length <= maxSuggestions * (useSmoothing ? 3 : 2)) {
            let fuzzyChecksCount = 0;
            for (const ext of languageExtensions) {
                const languageData = this.model.ngrams[ext];
                if (!languageData)
                    continue;

                for (const [storedContextKey, nextTokens] of Object.entries(languageData)) {
                    if (fuzzyChecksCount >= maxFuzzyChecks) break;
                    fuzzyChecksCount++;
                    if (storedContextKey === contextKey)
                        continue;

                    const storedContext = JSON.parse(storedContextKey);
                    const similarity = calculateSimilarity(context, storedContext);
                    const fuzzyThreshold = minConfidence * (useSmoothing ? 0.7 : 1.0);

                    if (similarity >= fuzzyThreshold) {
                        const total = Object.values(nextTokens).reduce((sum, count) => sum + count, 0);

                        for (const [token, count] of Object.entries(nextTokens)) {
                            const confidence = similarity * (count / total) * (useSmoothing ? 0.8 : 1.0);
                            if (confidence >= fuzzyThreshold && !usedTokens.has(token)) {
                                matches.push({ token, confidence });
                                usedTokens.add(token);
                            }
                        }
                    }
                    if (matches.length > maxSuggestions * (useSmoothing ? 100 : 45))
                        break;
                }
            }
        }

        // Smoothing
        if (useSmoothing && this.model.vocab && matches.length < maxSuggestions) {
            const remainingSlots = maxSuggestions - matches.length;
            const smoothedSuggestions = this.getSmoothedSuggestions(
                context,
                languageExtensions,
                remainingSlots,
                minConfidence * 0.5,
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
        const contextKey = JSON.stringify(context).replaceAll('","', '", "');

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

            if (totalCount === 0) {
                const globalFreq = calculateGlobalTokenFrequency(languageData);
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

    public async reloadModel() {
        this.model = null;
        this.isModelLoaded = false;
        await this.loadModel();
    }

    public clearProjectContext() {
        this.projectModel.clear();
        vscode.workspace.textDocuments.forEach(document => {
            this.projectModel.addDocument(document);
        });
    }

    public getProjectContextStats() {
        return this.projectModel.getProjectStats();
    }

    private shouldAddSpaceBeforeSuggestion(document: vscode.TextDocument, position: vscode.Position): boolean {
        const textBeforeCursor = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const lastChar = textBeforeCursor.trimEnd().slice(-1);
        const lastWord = textBeforeCursor.trim().split(/\s+/).pop();
        return (lastChar === '=' || lastWord === 'new' || lastWord === 'await') && !textBeforeCursor.endsWith(' ');
    }
}
