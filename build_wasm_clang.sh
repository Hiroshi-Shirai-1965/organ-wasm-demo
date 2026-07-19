#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

clang++ --target=wasm32 -O3 -std=c++17 -ffreestanding -fno-exceptions -fno-rtti -nostdlib \
  -Wl,--no-entry -Wl,--export-memory -Wl,--strip-all \
  -Wl,--export=organ_init \
  -Wl,--export=organ_set_registration \
  -Wl,--export=organ_note_on \
  -Wl,--export=organ_note_off \
  -Wl,--export=organ_all_notes_off \
  -Wl,--export=organ_get_voice_count \
  -Wl,--export=organ_get_output_buffer \
  -Wl,--export=organ_get_max_block_size \
  -Wl,--export=organ_render \
  -Wl,--initial-memory=131072 -Wl,--max-memory=131072 \
  organ_engine.cpp -o organ_engine.wasm

echo "Built organ_engine.wasm successfully."
