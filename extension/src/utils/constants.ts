export const LANGUAGE_EXTENSIONS: { [key: string]: string[] } = {
    '.cs': ['.cs', '.cshtml'],
    '.js': ['.js', '.vue'],
    '.ts': ['.ts', '.tsx'],
    '.py': ['.py']
};

export const EXTENSION_TO_LANGUAGE: { [key: string]: string } = {
    '.cs': '.cs',
    '.cshtml': '.cs',
    '.js': '.js',
    '.vue': '.js',
    '.ts': '.ts',
    '.tsx': '.ts',
    '.py': '.py'
};
