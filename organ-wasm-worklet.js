class OrganWasmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    try {
      const wasmModule = options.processorOptions?.wasmModule;
      if (!(wasmModule instanceof WebAssembly.Module)) {
        throw new Error("A compiled WebAssembly.Module was not supplied.");
      }

      this.instance = new WebAssembly.Instance(wasmModule, {});
      this.engine = this.instance.exports;
      this.memory = this.engine.memory;

      this.engine.organ_init(sampleRate);
      this.maxBlockSize = this.engine.organ_get_max_block_size();
      this.outputPointer = this.engine.organ_get_output_buffer();
      this.outputView = new Float32Array(
        this.memory.buffer,
        this.outputPointer,
        this.maxBlockSize,
      );

      this.lastVoiceCount = -1;
      this.port.onmessage = (event) => this.handleMessage(event.data);
      this.port.postMessage({ type: "ready", sampleRate });
    } catch (error) {
      this.engine = null;
      this.port.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  handleMessage(message) {
    if (!this.engine || !message) return;

    switch (message.type) {
      case "noteOn":
        this.engine.organ_note_on(
          message.voiceId,
          message.frequency,
          message.velocity,
        );
        break;

      case "noteOff":
        this.engine.organ_note_off(message.voiceId);
        break;

      case "allNotesOff":
        this.engine.organ_all_notes_off();
        break;

      case "setRegistration":
        this.engine.organ_set_registration(message.registration);
        break;
    }
  }

  refreshOutputViewIfNeeded() {
    if (this.outputView.buffer !== this.memory.buffer) {
      this.outputView = new Float32Array(
        this.memory.buffer,
        this.outputPointer,
        this.maxBlockSize,
      );
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const frameCount = output[0].length;

    if (!this.engine) {
      for (const channel of output) channel.fill(0);
      return true;
    }

    let destinationOffset = 0;

    while (destinationOffset < frameCount) {
      const chunkSize = Math.min(
        this.maxBlockSize,
        frameCount - destinationOffset,
      );

      this.engine.organ_render(chunkSize);
      this.refreshOutputViewIfNeeded();

      for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
        output[channelIndex].set(
          this.outputView.subarray(0, chunkSize),
          destinationOffset,
        );
      }

      destinationOffset += chunkSize;
    }

    const voiceCount = this.engine.organ_get_voice_count();
    if (voiceCount !== this.lastVoiceCount) {
      this.lastVoiceCount = voiceCount;
      this.port.postMessage({ type: "voiceCount", count: voiceCount });
    }

    return true;
  }
}

registerProcessor("organ-wasm-engine", OrganWasmProcessor);
