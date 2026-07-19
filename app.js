const enableButton = document.querySelector("#enableAudio");
const panicButton = document.querySelector("#panic");
const volumeSlider = document.querySelector("#masterVolume");
const registrationSelect = document.querySelector("#registration");
const statusText = document.querySelector("#status");
const keyboardElement = document.querySelector("#keyboard");

let audioContext = null;
let engineNode = null;
let masterGain = null;
let nextVoiceId = 1;

const activeNotes = new Map();
const pointerNotes = new Map();

const computerKeyMap = new Map([
  ["a", 60], ["w", 61], ["s", 62], ["e", 63],
  ["d", 64], ["f", 65], ["t", 66], ["g", 67],
  ["y", 68], ["h", 69], ["u", 70], ["j", 71],
  ["k", 72],
]);

const blackPitchClasses = new Set([1, 3, 6, 8, 10]);

function frequencyFromMidi(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function setStatus(message) {
  statusText.textContent = message;
}

async function loadWasmModule() {
  const response = await fetch("organ_engine.wasm");

  if (!response.ok) {
    throw new Error(`WASM load failed: HTTP ${response.status}`);
  }

  const bytes = await response.arrayBuffer();
  return WebAssembly.compile(bytes);
}

async function initializeAudio() {
  if (audioContext) {
    await audioContext.resume();
    return;
  }

  enableButton.disabled = true;
  setStatus("Loading C++ WebAssembly engine...");

  try {
    // Compile the WASM module on the main thread, then pass the compiled module
    // to the AudioWorklet. This avoids fetching files inside the audio thread.
    const wasmModule = await loadWasmModule();

    audioContext = new AudioContext({ latencyHint: "interactive" });
    await audioContext.audioWorklet.addModule("organ-wasm-worklet.js");

    engineNode = new AudioWorkletNode(audioContext, "organ-wasm-engine", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasmModule },
    });

    masterGain = new GainNode(audioContext, {
      gain: Number(volumeSlider.value),
    });

    const limiter = new DynamicsCompressorNode(audioContext, {
      threshold: -6,
      knee: 3,
      ratio: 18,
      attack: 0.003,
      release: 0.16,
    });

    engineNode.connect(masterGain).connect(limiter).connect(audioContext.destination);

    engineNode.port.onmessage = (event) => {
      const message = event.data;

      if (message?.type === "ready") {
        setStatus(`C++ / WASM ready — ${message.sampleRate} Hz`);
      } else if (message?.type === "voiceCount") {
        setStatus(`C++ / WASM active voices: ${message.count}`);
      } else if (message?.type === "error") {
        setStatus(`Engine error: ${message.message}`);
      }
    };

    engineNode.port.postMessage({
      type: "setRegistration",
      registration: Number(registrationSelect.value),
    });

    await audioContext.resume();
    enableButton.textContent = "Audio Enabled";
    setStatus(`C++ / WASM ready — ${audioContext.sampleRate} Hz`);
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error));
    enableButton.disabled = false;
  }
}

volumeSlider.addEventListener("input", () => {
  if (!audioContext || !masterGain) return;

  masterGain.gain.setTargetAtTime(
    Number(volumeSlider.value),
    audioContext.currentTime,
    0.015,
  );
});

registrationSelect.addEventListener("change", () => {
  engineNode?.port.postMessage({
    type: "setRegistration",
    registration: Number(registrationSelect.value),
  });
});

function noteOn(midi, sourceId) {
  if (!engineNode || activeNotes.has(sourceId)) return;

  const voiceId = nextVoiceId++;
  activeNotes.set(sourceId, { midi, voiceId });

  engineNode.port.postMessage({
    type: "noteOn",
    voiceId,
    frequency: frequencyFromMidi(midi),
    velocity: 0.78,
  });

  document.querySelector(`[data-midi="${midi}"]`)?.classList.add("active");
}

function noteOff(sourceId) {
  const note = activeNotes.get(sourceId);
  if (!note || !engineNode) return;

  engineNode.port.postMessage({
    type: "noteOff",
    voiceId: note.voiceId,
  });

  activeNotes.delete(sourceId);

  const stillActive = [...activeNotes.values()].some((item) => item.midi === note.midi);
  if (!stillActive) {
    document.querySelector(`[data-midi="${note.midi}"]`)?.classList.remove("active");
  }
}

function allNotesOff() {
  engineNode?.port.postMessage({ type: "allNotesOff" });

  activeNotes.clear();
  pointerNotes.clear();
  document.querySelectorAll(".key.active").forEach((key) => {
    key.classList.remove("active");
  });
}

function buildKeyboard() {
  const startMidi = 48;
  const endMidi = 72;
  const whiteWidth = 64;
  let whiteIndex = 0;

  for (let midi = startMidi; midi <= endMidi; midi += 1) {
    const isBlack = blackPitchClasses.has(midi % 12);
    const key = document.createElement("button");

    key.type = "button";
    key.className = `key ${isBlack ? "black" : "white"}`;
    key.dataset.midi = String(midi);
    key.setAttribute("aria-label", `MIDI note ${midi}`);

    if (isBlack) {
      key.style.left = `${whiteIndex * whiteWidth - 20}px`;
    } else {
      key.style.left = `${whiteIndex * whiteWidth}px`;
      whiteIndex += 1;
    }

    const assignedKeyboardKey = [...computerKeyMap.entries()]
      .find(([, mappedMidi]) => mappedMidi === midi)?.[0];

    if (assignedKeyboardKey) {
      const label = document.createElement("span");
      label.className = "key-label";
      label.textContent = assignedKeyboardKey.toUpperCase();
      key.appendChild(label);
    }

    key.addEventListener("pointerdown", async (event) => {
      event.preventDefault();
      await initializeAudio();
      key.setPointerCapture(event.pointerId);
      const sourceId = `pointer-${event.pointerId}`;
      pointerNotes.set(event.pointerId, sourceId);
      noteOn(midi, sourceId);
    });

    const releasePointer = (event) => {
      const sourceId = pointerNotes.get(event.pointerId);
      if (sourceId) {
        noteOff(sourceId);
        pointerNotes.delete(event.pointerId);
      }
    };

    key.addEventListener("pointerup", releasePointer);
    key.addEventListener("pointercancel", releasePointer);
    key.addEventListener("lostpointercapture", releasePointer);

    keyboardElement.appendChild(key);
  }
}

enableButton.addEventListener("click", initializeAudio);
panicButton.addEventListener("click", allNotesOff);

window.addEventListener("keydown", async (event) => {
  const keyName = event.key.toLowerCase();
  const midi = computerKeyMap.get(keyName);

  if (midi === undefined || event.repeat) return;

  event.preventDefault();
  await initializeAudio();
  noteOn(midi, `keyboard-${keyName}`);
});

window.addEventListener("keyup", (event) => {
  const keyName = event.key.toLowerCase();

  if (!computerKeyMap.has(keyName)) return;

  event.preventDefault();
  noteOff(`keyboard-${keyName}`);
});

window.addEventListener("blur", allNotesOff);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) allNotesOff();
});

buildKeyboard();
