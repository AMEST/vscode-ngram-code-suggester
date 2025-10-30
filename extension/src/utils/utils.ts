export function tokenizeText(text: string): string[] {
    const tokens: string[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;

        const lineTokens = trimmed.match(
            /[a-zA-Z_][a-zA-Z0-9_]*|[0-9.]+|[+\-*/=<>!&|^~%]+|[:;,\.\(\)\[\]\{\}]|".*?"|'.*?'/g
        ) || [];

        tokens.push(...lineTokens);
    }

    return tokens;
}

export function calculateSimilarity(tokens1: string[], tokens2: string[]): number {
    const minLength = Math.min(tokens1.length, tokens2.length);
    if (minLength === 0)
        return 0;

    let matches = 0;
    // Compare from the end (the most relevant context)
    for (let i = 1; i <= minLength; i++) {
        if (tokens1[tokens1.length - i] === tokens2[tokens2.length - i])
            matches++;
    }

    // We weigh the similarities - the latter tokens are more important
    return matches / minLength;
}

export function calculateGlobalTokenFrequency(languageData: any): { [token: string]: number } {
    const frequency: { [token: string]: number } = {};

    for (const contextData of Object.values(languageData)) {
        for (const [token, count] of Object.entries(contextData as { [token: string]: number })) {
            frequency[token] = (frequency[token] || 0) + (count as number);
        }
    }

    return frequency;
}
