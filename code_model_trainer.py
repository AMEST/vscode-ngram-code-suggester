# -*- coding: utf-8 -*-
import glob
import os
import re
import json
import gzip
from collections import defaultdict, Counter
import argparse

class CodeNGramModel:
    def __init__(self, n=4, smoothing='laplace', alpha=1.0):
        self.n = n
        self.ngrams = defaultdict(lambda: defaultdict(Counter))
        self.file_extensions = set()
        self.total_patterns = 0
        self.version = "2.2"  # Обновленная версия
        self.smoothing = smoothing
        self.alpha = alpha
        self.vocab = defaultdict(set)
    
    def train_on_file(self, filepath):
        """Обучает модель на одном файле с учетом расширения"""
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            
            ext = os.path.splitext(filepath)[1].lower()
            self.file_extensions.add(ext)
            
            tokens = self._tokenize_code(content, ext)
            self.vocab[ext].update(tokens)
            sequences = self._extract_sequences(tokens, ext)
            
            for seq in sequences:
                if len(seq) >= self.n:
                    for i in range(len(seq) - self.n + 1):
                        context = tuple(seq[i:i + self.n - 1])
                        next_token = seq[i + self.n - 1]
                        self.ngrams[ext][context][next_token] += 1
                        self.total_patterns += 1
            
            print(f"Processed {filepath}: {len(tokens)} tokens, {len(sequences)} sequences")
            
        except Exception as e:
            print(f"Error processing {filepath}: {e}")

    def _tokenize_code(self, content, ext):
        """Токенизация кода с учетом конкретного языка"""
        tokens = []
        lines = content.split('\n')
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            if ext == '.cs':
                line_tokens = self._tokenize_csharp(line)
            elif ext in ['.js', '.ts']:
                line_tokens = self._tokenize_javascript(line)
            elif ext == '.py':
                line_tokens = self._tokenize_python(line)
            else:
                line_tokens = self._tokenize_general(line)
            
            tokens.extend(line_tokens)
        
        return tokens
    
    def _tokenize_csharp(self, line):
        tokens = re.findall(
            r'public|private|protected|internal|class|interface|struct|enum|void|string|int|bool|float|double|'
            r'var|new|using|namespace|get|set|return|if|else|for|foreach|while|switch|case|break|continue|'
            r'[a-zA-Z_][a-zA-Z0-9_]*|[0-9.]+|[+\-*/=<>!&|^~%]+|[:;,\.\(\)\[\]\{\}<>]|".*?"|\'.*?\'|@".*?"',
            line
        )
        return [t for t in tokens if t.strip()]
    
    def _tokenize_javascript(self, line):
        tokens = re.findall(
            r'function|const|let|var|class|interface|type|export|import|from|default|return|'
            r'if|else|for|while|switch|case|break|continue|=>|'
            r'[a-zA-Z_][a-zA-Z0-9_]*|[0-9.]+|[+\-*/=<>!&|^~%]+|[:;,\.\(\)\[\]\{\}]|".*?"|\'.*?\'|`.*?`',
            line
        )
        return [t for t in tokens if t.strip()]
    
    def _tokenize_python(self, line):
        tokens = re.findall(
            r'def|class|self|import|from|as|return|if|elif|else|for|while|in|try|except|finally|with|lambda|'
            r'[a-zA-Z_][a-zA-Z0-9_]*|[0-9.]+|[+\-*/=<>!&|^~%]+|[:;,\.\(\)\[\]\{\}]|".*?"|\'.*?\'',
            line
        )
        return [t for t in tokens if t.strip()]
    
    def _tokenize_general(self, line):
        tokens = re.findall(
            r'[a-zA-Z_][a-zA-Z0-9_]*|[0-9.]+|[+\-*/=<>!&|^~%]+|[:;,\.\(\)\[\]\{\}]|".*?"|\'.*?\'',
            line
        )
        return [t for t in tokens if t.strip()]
    
    def _extract_sequences(self, tokens, ext):
        sequences = []
        current_sequence = []
        
        language_specific_enders = {
            '.cs': [';', '{', '}'],
            '.js': [';', '{', '}'],
            '.ts': [';', '{', '}'],
            '.py': [':']
        }
        
        enders = language_specific_enders.get(ext, [';'])
        
        for token in tokens:
            current_sequence.append(token)
            
            if token in enders:
                if current_sequence:
                    sequences.append(current_sequence)
                    current_sequence = []
            elif token in {'return', 'break', 'continue', 'pass'}:
                if current_sequence:
                    sequences.append(current_sequence)
                    current_sequence = []
        
        if current_sequence:
            sequences.append(current_sequence)
        
        return sequences
    
    def to_serializable(self):
        """Конвертирует модель в сериализуемый формат"""
        serializable_ngrams = {}
        for ext, contexts in self.ngrams.items():
            serializable_ngrams[ext] = {}
            for context, counter in contexts.items():
                context_key = json.dumps(list(context))
                serializable_ngrams[ext][context_key] = dict(counter)
        
        serializable_vocab = {}
        for ext, tokens in self.vocab.items():
            serializable_vocab[ext] = list(tokens)
        
        return {
            'version': self.version,
            'n': self.n,
            'ngrams': serializable_ngrams,
            'vocab': serializable_vocab,
            'file_extensions': list(self.file_extensions),
            'total_patterns': self.total_patterns,
            'smoothing': self.smoothing,
            'alpha': self.alpha
        }
    
    def save(self, filepath, compress=True):
        """Сохраняет модель в JSON файл"""
        data = self.to_serializable()
        
        if compress:
            filepath += '.gz'
            with gzip.open(filepath, 'wt', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        else:
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        
        print(f"Model saved to {filepath} with {self.total_patterns} patterns across {len(self.file_extensions)} languages")
        print(f"Smoothing method: {self.smoothing}, Alpha: {self.alpha}")
    
    def load(self, filepath):
        """Загружает модель из JSON файла"""
        if filepath.endswith('.gz'):
            with gzip.open(filepath, 'rt', encoding='utf-8') as f:
                data = json.load(f)
        else:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
        
        self.version = data['version']
        self.n = data['n']
        self.file_extensions = set(data['file_extensions'])
        self.total_patterns = data['total_patterns']
        self.smoothing = data.get('smoothing', 'none')
        self.alpha = data.get('alpha', 1.0)
        
        self.ngrams = defaultdict(lambda: defaultdict(Counter))
        for ext, contexts in data['ngrams'].items():
            for context_key, tokens in contexts.items():
                context = tuple(json.loads(context_key))
                self.ngrams[ext][context] = Counter(tokens)
        
        self.vocab = defaultdict(set)
        for ext, tokens in data.get('vocab', {}).items():
            self.vocab[ext] = set(tokens)
        
        print(f"Model loaded from {filepath} with {self.total_patterns} patterns for {len(self.file_extensions)} languages")
        print(f"Smoothing method: {self.smoothing}, Alpha: {self.alpha}")

def main():
    parser = argparse.ArgumentParser(description='Train code suggestion model with language support and smoothing')
    parser.add_argument('--model', '-m', required=True, help='Model file path')
    parser.add_argument('--pattern', '-p', help='Glob pattern for code files')
    parser.add_argument('--language', '-l', choices=['cs', 'js', 'ts', 'py', 'all'], help='Language to train on')
    parser.add_argument('--n-gram', '-n', type=int, default=4, help='N-gram size (default: 4)')
    parser.add_argument('--smoothing', '-s', choices=['none', 'laplace', 'kneser_ney'], 
                       default='laplace', help='Smoothing method (default: laplace)')
    parser.add_argument('--alpha', '-a', type=float, default=1.0, help='Alpha parameter for Laplace smoothing (default: 1.0)')
    parser.add_argument('--no-compress', action='store_true', help='Save without compression')
    
    args = parser.parse_args()
    
    patterns = []
    if args.language:
        language_patterns = {
            'cs': '**/*.cs',
            'js': '**/*.js',
            'ts': '**/*.ts',
            'py': '**/*.py',
            'all': '**/*.{cs,js,ts,py}'
        }
        patterns.append(language_patterns[args.language])
    
    if args.pattern:
        patterns.append(args.pattern)
    
    if not patterns:
        print("Please specify either --pattern or --language")
        return
    
    model = CodeNGramModel(n=args.n_gram, smoothing=args.smoothing, alpha=args.alpha)
    
    model_path = args.model
    if not model_path.endswith('.gz') and not args.no_compress:
        model_path += '.gz'
    
    if os.path.exists(model_path) or (not args.no_compress and os.path.exists(args.model)):
        try:
            model.load(model_path)
        except Exception as e:
            print(f"Error loading model, creating new: {e}")
    
    all_files = []
    for pattern in patterns:
        files = glob.glob(pattern, recursive=True)
        filtered_files = [f for f in files if 'node_modules' not in f.split(os.sep)]
        all_files.extend(filtered_files)
        print(f"Found {len(filtered_files)} files for pattern: {pattern}")
        
    for i, filepath in enumerate(all_files):
        print(f"Processing {i+1}/{len(all_files)}: {filepath}")
        model.train_on_file(filepath)
    
    model.save(args.model, compress=not args.no_compress)
    
    print("\nTraining completed! Statistics by language:")
    for ext in model.file_extensions:
        patterns_count = sum(len(contexts) for contexts in model.ngrams[ext].values())
        vocab_size = len(model.vocab[ext])
        print(f"  {ext}: {patterns_count} patterns, {vocab_size} unique tokens")

if __name__ == "__main__":
    main()
