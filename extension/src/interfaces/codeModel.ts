export interface CodeModel {
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
