# Web Organ — C++ / WebAssembly demo

ブラウザー上の鍵盤から、WebAssembly化したC++音源を操作するデモです。

## システム構成

```text
Keyboard UI
    ↓
app.js
    ↓ MessagePort
AudioWorklet
    ↓ exported C functions
organ_engine.wasm
    ↓ 128-sample audio block
Web Audio API
    ↓
Speaker
```

- 画面と鍵盤操作: `index.html`, `style.css`, `app.js`
- リアルタイム音声スレッド: `organ-wasm-worklet.js`
- C++音源: `organ_engine.cpp`
- コンパイル済みWebAssembly: `organ_engine.wasm`

## 起動方法

AudioWorkletとWebAssemblyを使用するため、HTMLを直接ダブルクリックせず、
ローカルWebサーバーから開いてください。

### Windows

1. ZIPを展開します。
2. `start_server.bat`をダブルクリックします。
3. ブラウザーで `http://localhost:8000` を開きます。
4. `Enable Audio`を押します。

Python 3が必要です。コマンドから起動する場合は、フォルダー内で次を実行します。

```shell
python -m http.server 8000
```

## 操作

- 画面の鍵盤をマウスまたはタッチで操作できます。
- PCキーボードでも演奏できます。
  - 白鍵: `A S D F G H J K`
  - 黒鍵: `W E T Y U`
- `Registration`で倍音構成を切り替えます。
- `All Notes Off`ですべての音をリリースします。

## C++側の主な公開関数

```cpp
void organ_init(float sample_rate);
void organ_note_on(int voice_id, float frequency, float velocity);
void organ_note_off(int voice_id);
void organ_all_notes_off();
void organ_set_registration(int registration);
void organ_render(int frames);
int  organ_get_output_buffer();
int  organ_get_max_block_size();
int  organ_get_voice_count();
```

`organ_render()`がC++内で音声ブロックを生成し、AudioWorkletがWASMメモリー上の
出力バッファを読み取ってスピーカーへ送ります。

## WebAssemblyの再ビルド

コンパイル済みの `organ_engine.wasm` が含まれているため、通常はビルド不要です。
ソースを変更した場合は、LLVM/ClangをPATHに登録して次を実行します。

- Windows: `build_wasm_clang.bat`
- macOS/Linux: `./build_wasm_clang.sh`

使用している方式は、OS依存機能や標準ライブラリーを使わない小さな
standalone WebAssemblyです。将来のトランペット版では、同じ境界を維持したまま、
`organ_engine.cpp`をシミュレーションコアへ置き換えられます。
