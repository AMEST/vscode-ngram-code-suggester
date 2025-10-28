# VSCode N-Gram Code Suggester
> **⚠️  Experimental Project – Not for Production Use**  
> This repository demonstrates a research prototype that implements a simple n‑gram language model for code completion in VS Code. It is **not** guaranteed to be stable, fast, or secure enough for production workloads. Use at your own risk.

## Overview

**VSCode N‑Gram Code Suggester** is a proof‑of‑concept that combines:

| Component             | Description                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **VS Code extension** | Hooks into the editor’s Inline Suggest API and uses the trained n‑gram model to surface context‑aware completions. |
| **Model file**        | A lightweight model that stores trigram/tag frequencies.                                                           |

The idea is to show that even a *single‑sentence* context can yield useful suggestions, without the heavy machinery of large neural models.

---

## Quick Start

> ⚠️ The following steps assume you have Python 3.9+ installed and a recent VS Code release.

1. **Build and Install the extension**

   ```bash
   # Build VSIX package
   cd extension
   npm install
   vsce package

   # Install VSIX in VS Code
   code --install-extension vscode-ngram-suggester-1.1.0.vsix
   ```

2. **Download a pre-trained model**  
   You can download pre-trained models from the [GitHub repository](https://github.com/amest/vscode-ngram-code-suggester).
3. **Configure full path to downloaded model**.    
   If extension builded without model, you need configure full path to model in extensions settings.   
   Else if extension builded with model (*downloaded and saved to `extension/models` path*), check relative path in extension configuration and skip this step.
4. **Enjoy autocompletion**   
   Open a supported file, type a few tokens (words), and wait for auto‑suggestions.

> **⚠️  Important about configuration**   
> If you use a large model (more than 2 million patterns), you may need to disable "Fuzzy search" and "Use Smoothing" for better performance. If suggestions are still slow, enable "Use Trigger Characters" option.   
> For smaller models, keep these settings enabled for better suggestion quality.

## Extension Settings

Below is a quick reference to all user‑configurable options for the extension.  
Add any of these to your *workspace* or *user* `settings.json` to tweak the behaviour.

| Setting                                | Type    | Default                  | Constraints | Description                                                                                                                                                    |
| -------------------------------------- | ------- | ------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **codeSuggester.modelPath**            | string  | `./models/model.json.gz` | –           | Path to the trained model file. Supports plain `.json` or gzipped `.json.gz`.                                                                                  |
| **codeSuggester.maxSuggestions**       | number  | `5`                      | `1 – 10`    | Maximum number of suggestions displayed in the IntelliSense list.                                                                                              |
| **codeSuggester.maxFuzzyChecks**       | number  | `2000`                   | `≥ 1000`    | Maximum number of fuzzy‑search checks performed. Higher values give better matches but can be slow on large models.                                            |
| **codeSuggester.minConfidence**        | number  | `0.2`                    | `0.0 – 1.0` | Minimum confidence threshold for a suggestion to be shown.                                                                                                     |
| **codeSuggester.enableFuzzyMatching**  | boolean | `false`                  | –           | Turns on fuzzy matching for similar code patterns. ⚠️Use only on small models⚠️                                                                                  |
| **codeSuggester.useSmoothing**         | boolean | `false`                  | –           | Enables smoothing algorithms to better handle rare n‑grams. ⚠️Use only on small models⚠️                                                  |
| **codeSuggester.useTriggerCharacters** | boolean | `false`                  | –           | When enabled, suggestions are only triggered when the cursor is placed on a trigger character (`. , ( ) [ { : ; =`). Useful if auto‑suggestions feel sluggish. |
| **codeSuggester.useProjectContext**    | boolean | `true`                   | -           | Use project context from open files for suggestions                                                                                                            |
| **codeSuggester.updateOnFileChange**   | boolean | `false`                  | -           | Update project model when files are modified (may impact performance)                                                                                          |
---

## Model Training

For information on training your own models, please refer to the [full documentation on GitHub](https://github.com/amest/vscode-ngram-code-suggester).

---

## License

Distributed under the MIT License. See the `LICENSE` file for details.
