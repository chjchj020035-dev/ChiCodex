# OpenClaw + MiniMind

The Expo app now runs an OpenClaw Agent wrapper around the configured model. It
selects a chat/task/memory mode, injects the soul-container runtime, and records
the current chat session in AsyncStorage under
`openclaw_chat_history`. Export that JSON array from the device, then convert it
to MiniMind's SFT format:

```bash
python training/prepare_openclaw_dataset.py history.json training/openclaw_sft.jsonl
```

Clone MiniMind separately and run the trainer from its repository root:

```bash
bash /workspaces/ChiCodex/training/train_openclaw_minimind.sh \
  /workspaces/ChiCodex/training/openclaw_sft.jsonl
```

After training, serve the exported model through an OpenAI-compatible endpoint
(for example vLLM or llama.cpp) and set this Expo variable before starting:

```bash
EXPO_PUBLIC_OPENCLAW_MODEL=openclaw npm start
```

The app keeps its existing endpoint and falls back to `gpt-5.6-sol` until a
MiniMind server is configured. Training requires a separate Python/PyTorch
environment; it cannot run inside Expo or on the phone.
