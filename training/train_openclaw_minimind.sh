#!/usr/bin/env bash
set -euo pipefail

# Run from the MiniMind repository root after copying training/openclaw_sft.jsonl
# into its dataset directory. MiniMind's SFT trainer accepts --data_path in the
# current releases; pass extra flags after the dataset path when needed.
DATA_PATH="${1:?usage: train_openclaw_minimind.sh DATASET_JSONL [extra trainer args]}"
shift

if [[ ! -f "$DATA_PATH" ]]; then
  echo "Dataset not found: $DATA_PATH" >&2
  exit 1
fi

python trainer/train_full_sft.py \
  --data_path "$DATA_PATH" \
  --save_dir ./out/openclaw \
  --epochs 2 \
  --batch_size 2 \
  --learning_rate 2e-5 \
  "$@"
