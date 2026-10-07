# The listening model's files

The server hears each song with **CLaMP 3** (docs/features/audio-intelligence.md, "How songs
sound"). It runs the model on onnxruntime, from five files this folder makes, and downloads them
from the repository's `sound-models-v1` release the first time analysis wants them.

```sh
uv venv -p 3.11 .venv && uv pip install -p .venv -r scripts/sound-models/requirements.txt
.venv/bin/python scripts/sound-models/export.py /tmp/sound-models
```

The script prints each file's size and SHA-256 for `SOUND_MODEL` in
`apps/server/src/sound/models.ts`. With the same requirements it reproduces the release byte for
byte. A new export is a new model: bump `SOUND_MODEL.name` and the release tag together, and every
song is heard again.

```sh
gh release create sound-models-v2 /tmp/sound-models/* --title "…" --notes-file …
```

To try files before they are released, point a server at the folder:
`SELFMP3_SOUND_MODELS=/tmp/sound-models`. `apps/server/src/sound/eval.ts` hears a folder of songs
with them and prints what each description finds.

## Licences

| Part | From | Licence |
| --- | --- | --- |
| CLaMP 3 (SAAS weights, code) | [sanderwood/clamp3](https://github.com/sanderwood/clamp3) | MIT |
| MERT-v1-95M (inside `mert.onnx`) | [m-a-p/MERT-v1-95M](https://huggingface.co/m-a-p/MERT-v1-95M) | CC BY-NC 4.0: non-commercial |
| XLM-RoBERTa base (inside `clamp3_text.onnx`, tokenizer) | [FacebookAI/xlm-roberta-base](https://huggingface.co/FacebookAI/xlm-roberta-base) | MIT |

The files are a download of their own for their size (about 750 MB, more than the rest of the image).
MERT's licence means they are for a personal library like this one, not for anything sold.
