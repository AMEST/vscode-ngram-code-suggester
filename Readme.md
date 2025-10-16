# VSCode N-Gram Code Suggester
> **⚠️  Experimental Project – Not for Production Use**  
> This repository demonstrates a research prototype that implements a simple n‑gram language model for code completion in VS Code. It is **not** guaranteed to be stable, fast, or secure enough for production workloads. Use at your own risk, and please report issues or feature requests in the issues tracker.

---

- [VSCode N-Gram Code Suggester](#vscode-n-gram-code-suggester)
  - [Overview](#overview)
  - [Quick Start](#quick-start)
  - [How to Train model](#how-to-train-model)
      - [CLI Args](#cli-args)
      - [Example](#example)
      - [Github project for train model](#github-project-for-train-model)
  - [License](#license)

## Overview

**VSCode N‑Gram Code Suggester** is a proof‑of‑concept that combines:

| Component                   | Description                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Python training utility** | Leverages `argparse` to train an n‑gram model on a codebase. Supports a handful of languages (C#, JavaScript, TypeScript, Python, or all). |
| **VS Code extension**       | Hooks into the editor’s Inline Suggest API and uses the trained n‑gram model to surface context‑aware completions.                         |
| **Model file**              | A lightweight pickled model that stores trigram/tag frequencies.                                                                           |

The idea is to show that even a *single‑sentence* context can yield useful suggestions, without the heavy machinery of large neural models.

---

## Quick Start

> ⚠️ The following steps assume you have Python 3.9+ installed and a recent VS Code release.

1. **Clone the repo**

   ```bash
   git clone https://github.com/amest/vscode-ngram-code-suggester.git
   cd vscode-ngram-code-suggester
   ```

2. **Train a model on your codebase**

   ```bash
   python3 code_model_trainer.py \
     --model extensions/models/model.json \
     --language py
   ```

   > Replace the arguments above to fit your project. See the full CLI options table above.

3. **Build and Install the extension**

   ```bash
   # Build VSIX package
   cd extension
   npm install
   vsce package

   # Install VSIX in VS Code
   code --install-extension vscode-ngram-suggester-0.1.0.vsix
   ```

4. **Enjoy autocompletion**

   Open a C# file, type a few tokens (words), and wait for auto‑suggestions.

---

## How to Train model

For train model, need using python script `code_model_trainer.py`. Script scan code files in Glob pattern and index it.

#### CLI Args


| Argument        | Short flag | Required / Optional | Type / Data type      | Default         | Allowed values                | Description                                                      |
| --------------- | ---------- | ------------------- | --------------------- | --------------- | ----------------------------- | ---------------------------------------------------------------- |
| `--model`       | `-m`       | **Required**        | string (file path)    | –               | –                             | Path to the model file                                           |
| `--pattern`     | `-p`       | Optional            | string (glob pattern) | –               | –                             | Glob pattern to match code files                                 |
| `--language`    | `-l`       | Optional            | string                | –               | `cs`, `js`, `ts`, `py`, `all` | Programming language(s) to train on                              |
| `--n-gram`      | `-n`       | Optional            | integer               | `4`             | –                             | Size of the n‑gram (default: 4)                                  |
| `--smoothing`   | `-s`       | Optional            | string                | `laplace`       | `none`, `laplace`             | Smoothing method (default: laplace)                              |
| `--alpha`       | `-a`       | Optional            | float                 | `1.0`           | –                             | Alpha parameter for Laplace smoothing (default: 1.0)             |
| `--no-compress` | –          | Optional            | flag (boolean)        | `False` (unset) | –                             | Save the output without compression (set to `True` when present) |


#### Example
```
# Only C#
python3 code_model_trainer.py --model ./model.json --language cs

# Python & JavaScript
python3 code_model_trainer.py --model ./model.json --language py
python3 code_model_trainer.py --model ./model.json --language js

# Mixed use without compression
python3 code_model_trainer.py --model ./model.json --pattern "src/**/*.ts" --language cs --no-compress
```
#### Github project for train model

Clone repose in list and train you model:
1. CSharp:
   1. https://github.com/dotnet/aspnetcore
   2. https://github.com/dotnet/roslyn
2. Python
   1. https://github.com/django/django
3. TypeScript & JavaScript
   1. https://github.com/angular/angular
   2. https://github.com/facebook/react

---

## License

Distributed under the MIT License. See the `LICENSE` file for details.
