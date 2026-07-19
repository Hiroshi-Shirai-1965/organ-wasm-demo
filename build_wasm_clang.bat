@echo off
setlocal
cd /d "%~dp0"

where clang++ >nul 2>nul
if errorlevel 1 (
  echo clang++ was not found. Install LLVM and add it to PATH.
  pause
  exit /b 1
)

clang++ --target=wasm32 -O3 -std=c++17 -ffreestanding -fno-exceptions -fno-rtti -nostdlib ^
  -Wl,--no-entry -Wl,--export-memory -Wl,--strip-all ^
  -Wl,--export=organ_init ^
  -Wl,--export=organ_set_registration ^
  -Wl,--export=organ_note_on ^
  -Wl,--export=organ_note_off ^
  -Wl,--export=organ_all_notes_off ^
  -Wl,--export=organ_get_voice_count ^
  -Wl,--export=organ_get_output_buffer ^
  -Wl,--export=organ_get_max_block_size ^
  -Wl,--export=organ_render ^
  -Wl,--initial-memory=131072 -Wl,--max-memory=131072 ^
  organ_engine.cpp -o organ_engine.wasm

if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

echo Built organ_engine.wasm successfully.
pause
