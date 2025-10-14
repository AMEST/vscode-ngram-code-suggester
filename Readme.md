# VS Code N-Gram Code Suggester

### How to learn model

For train model, need using python script. Script scan code files in Glob pattern and index it.

#### CLI Args

|     Param     | param key |                    description                     |
| :-----------: | :-------: | :------------------------------------------------: |
|    --model    |    -m     |                  Model file path                   |
|   --pattern   |    -p     |            Glob pattern for code files             |
|  --language   |    -l     | Language to train on. Choices: cs, js, ts, py, all |
|   --n-gram    |    -n     |              N-gram size (default: 4)              |
| --no-compress |           |              Save without compression              |

#### Example
```
# Only C#
python3 code_model_trainer.py --model ./model.json --language cs

# Python & JavaScript
python3 code_model_trainer.py --model ./model.json --language py
python3 code_model_trainer.py --model ./model.json --language js

# All langs
python3 code_model_trainer.py --model ./model.json --language all

# Mixed use without compression
python3 code_model_trainer.py --model ./model.json --pattern "src/**/*.ts" --language cs --no-compress
```

