"""
Export CLaMP 3 to the ONNX files the server's listening model runs
(apps/server/src/sound/, docs/features/audio-intelligence.md "How songs sound").

    uv venv -p 3.11 .venv && uv pip install -p .venv -r scripts/sound-models/requirements.txt
    .venv/bin/python scripts/sound-models/export.py <out folder>

It clones CLaMP 3 at the commit below, downloads its SAAS weights and MERT,
and writes five files:

  mert.onnx           one 5 s chunk of 24 kHz audio (normalised over the clip)
                      -> its MERT vector: the mean over time and all 13 hidden states
  clamp3_audio.onnx   the chunks' vectors, between two zero frames -> the song's vector
  clamp3_text.onnx    XLM-RoBERTa token ids -> the description's vector
  tokenizer.json, tokenizer_config.json   XLM-RoBERTa's tokenizer

then prints each file's size and SHA-256, which go into SOUND_MODEL in
apps/server/src/sound/models.ts, and the files go up as a release
(`gh release create sound-models-vN <out folder>/*`).

The 8-bit choices are measured, not guessed (2026-10-07, 585 songs, against
CLaMP 3's own Python pipeline): MERT's convolutions do not survive 8-bit
(cosine 0.74), so only its matrix multiplications are, with per-channel
scales (0.998); the audio encoder is 8-bit throughout (0.9995); the text
encoder's matrix multiplications at 8-bit cost search quality ("solo
classical piano" lost two of its top ten), so only its vocabulary table is
(1.0000). Every check above passed with these.
"""

import hashlib
import os
import subprocess
import sys
import tempfile

CLAMP3_REPO = 'https://github.com/sanderwood/clamp3'
CLAMP3_COMMIT = '9016d2b0c8d12d1aa79c2e0ab201e6822bdc83a8'
CLAMP3_WEIGHTS = (
    'https://huggingface.co/sander-wood/clamp3/resolve/main/'
    'weights_clamp3_saas_h_size_768_t_model_FacebookAI_xlm-roberta-base_t_length_128_a_size_768_'
    'a_layers_12_a_length_128_s_size_768_s_layers_12_p_size_64_p_length_512.pth'
)


def main(out):
    import numpy as np
    import onnxruntime as ort
    import torch
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from huggingface_hub import hf_hub_download
    from transformers import BertConfig

    os.makedirs(out, exist_ok=True)
    work = tempfile.mkdtemp(prefix='clamp3-')
    repo = os.path.join(work, 'clamp3')
    subprocess.run(['git', 'clone', '-q', CLAMP3_REPO, repo], check=True)
    subprocess.run(['git', '-C', repo, 'checkout', '-q', CLAMP3_COMMIT], check=True)
    # 2.5 GB, most of it the optimiser's state: CLAMP3_WEIGHTS=<file> reuses a copy.
    weights = os.environ.get('CLAMP3_WEIGHTS') or os.path.join(work, 'clamp3.pth')
    if not os.path.exists(weights):
        subprocess.run(['curl', '-sSL', '--fail', '-o', weights, CLAMP3_WEIGHTS], check=True)

    sys.path.insert(0, os.path.join(repo, 'code'))
    sys.path.insert(0, os.path.join(repo, 'preprocessing', 'audio'))
    cwd = os.getcwd()
    os.chdir(os.path.join(repo, 'code'))
    import config as c  # CLaMP 3's own
    from utils import CLaMP3Model
    from MusicHubert import MusicHubertModel  # the class CLaMP 3's extractor loads MERT with
    os.chdir(cwd)

    torch.set_grad_enabled(False)
    audio_config = BertConfig(vocab_size=1, hidden_size=c.AUDIO_HIDDEN_SIZE,
                              num_hidden_layers=c.AUDIO_NUM_LAYERS,
                              num_attention_heads=c.AUDIO_HIDDEN_SIZE // 64,
                              intermediate_size=c.AUDIO_HIDDEN_SIZE * 4,
                              max_position_embeddings=c.MAX_AUDIO_LENGTH)
    symbolic_config = BertConfig(vocab_size=1, hidden_size=c.M3_HIDDEN_SIZE,
                                 num_hidden_layers=c.PATCH_NUM_LAYERS,
                                 num_attention_heads=c.M3_HIDDEN_SIZE // 64,
                                 intermediate_size=c.M3_HIDDEN_SIZE * 4,
                                 max_position_embeddings=c.PATCH_LENGTH)
    clamp = CLaMP3Model(audio_config=audio_config, symbolic_config=symbolic_config,
                        text_model_name=c.TEXT_MODEL_NAME, hidden_size=c.CLAMP3_HIDDEN_SIZE,
                        load_m3=False)
    clamp.load_state_dict(torch.load(weights, map_location='cpu', weights_only=True)['model'])
    clamp.eval()

    def pool(x, mask):
        m = mask.unsqueeze(-1).to(x.dtype)
        return (x * m).sum(1) / m.sum(1)

    class Mert(torch.nn.Module):
        def __init__(self):
            super().__init__()
            # transformers warns that the positional convolution is newly
            # initialised; it is not, the checkpoint's weight_g/weight_v are
            # renamed into it as it loads.
            self.m = MusicHubertModel.from_pretrained('m-a-p/MERT-v1-95M').eval()

        def forward(self, wav):
            states = self.m(wav, output_hidden_states=True).hidden_states
            return torch.stack(states).mean(-2).mean(0)

    class Audio(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.bert, self.proj = clamp.audio_model, clamp.audio_proj

        def forward(self, feats, mask):
            return self.proj(pool(self.bert(inputs_embeds=feats, attention_mask=mask).last_hidden_state, mask))

    class Text(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.enc, self.proj = clamp.text_model, clamp.text_proj

        def forward(self, ids, mask):
            return self.proj(pool(self.enc(ids, attention_mask=mask).last_hidden_state, mask))

    graphs = [
        ('mert', Mert().eval(), (torch.randn(1, 120000),), ['wav'], {'wav': {1: 'samples'}}),
        ('clamp3_audio', Audio().eval(), (torch.randn(1, 8, 768), torch.ones(1, 8, dtype=torch.long)),
         ['feats', 'mask'], {'feats': {1: 'len'}, 'mask': {1: 'len'}}),
        ('clamp3_text', Text().eval(), (torch.tensor([[0, 3293, 83, 10, 3034, 2]]), torch.ones(1, 6, dtype=torch.long)),
         ['ids', 'mask'], {'ids': {1: 'len'}, 'mask': {1: 'len'}}),
    ]
    quantise = {
        'mert': dict(op_types_to_quantize=['MatMul'], per_channel=True),
        'clamp3_audio': dict(),
        'clamp3_text': dict(op_types_to_quantize=['Gather']),
    }
    for name, module, args, inputs, axes in graphs:
        full = os.path.join(work, f'{name}.onnx')
        torch.onnx.export(module, args, full, input_names=inputs, output_names=['embedding'],
                          dynamic_axes=axes, opset_version=17, dynamo=False)
        target = os.path.join(out, f'{name}.onnx')
        quantize_dynamic(full, target, weight_type=QuantType.QInt8, **quantise[name])
        ref = module(*args).numpy()[0]
        got = ort.InferenceSession(target).run(None, {n: a.numpy() for n, a in zip(inputs, args)})[0][0]
        cosine = float(ref @ got / np.linalg.norm(ref) / np.linalg.norm(got))
        print(f'{name}: 8-bit against PyTorch, cosine {cosine:.4f}')

    # As published, byte for byte: saving them again through transformers rewrites them.
    for name in ('tokenizer.json', 'tokenizer_config.json'):
        with open(hf_hub_download(c.TEXT_MODEL_NAME, name), 'rb') as src, open(os.path.join(out, name), 'wb') as dst:
            dst.write(src.read())

    print('\nFor SOUND_MODEL.files in apps/server/src/sound/models.ts:')
    for name in ('mert.onnx', 'clamp3_audio.onnx', 'clamp3_text.onnx', 'tokenizer.json', 'tokenizer_config.json'):
        path = os.path.join(out, name)
        with open(path, 'rb') as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        print(f"  {{ name: '{name}', bytes: {os.path.getsize(path)}, sha256: '{digest}' }},")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: export.py <out folder>')
    main(sys.argv[1])
