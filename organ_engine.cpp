// Minimal polyphonic organ engine compiled to WebAssembly.
// No operating-system or browser APIs are used here; the browser calls the
// exported C functions from an AudioWorklet.

extern "C" {

static constexpr int kMaxVoices = 16;
static constexpr int kHarmonics = 6;
static constexpr int kMaxBlock = 128;
static constexpr float kPi = 3.14159265358979323846f;
static constexpr float kTwoPi = 6.28318530717958647692f;

struct Voice {
    int id;
    int active;
    int gate;
    float frequency;
    float velocity;
    float envelope;
    int renorm_counter;
    float sin_state[kHarmonics];
    float cos_state[kHarmonics];
    float sin_delta[kHarmonics];
    float cos_delta[kHarmonics];
};

static Voice g_voices[kMaxVoices];
static float g_output[kMaxBlock];
static float g_sample_rate = 48000.0f;
static float g_attack_step = 1.0f / (0.018f * 48000.0f);
static float g_release_step = 1.0f / (0.120f * 48000.0f);
static int g_registration = 0;

static const float kRegistrations[3][kHarmonics] = {
    {1.00f, 0.48f, 0.28f, 0.18f, 0.09f, 0.05f}, // Principal
    {1.00f, 0.16f, 0.06f, 0.025f, 0.01f, 0.005f}, // Flute
    {1.00f, 0.70f, 0.43f, 0.31f, 0.22f, 0.14f}  // Reed
};

static float absf(float value) {
    return value < 0.0f ? -value : value;
}

// Sine approximation sufficient for calculating the oscillator rotation
// coefficients at note-on. The per-sample oscillator itself uses a recurrence.
static float wrap_pi(float x) {
    while (x > kPi) x -= kTwoPi;
    while (x < -kPi) x += kTwoPi;
    return x;
}

static float fast_sin(float x) {
    x = wrap_pi(x);

    if (x > 0.5f * kPi) {
        x = kPi - x;
    } else if (x < -0.5f * kPi) {
        x = -kPi - x;
    }

    const float x2 = x * x;
    return x * (1.0f + x2 * (-1.0f / 6.0f
        + x2 * (1.0f / 120.0f
        + x2 * (-1.0f / 5040.0f
        + x2 * (1.0f / 362880.0f
        + x2 * (-1.0f / 39916800.0f))))));
}

static float fast_cos(float x) {
    x = wrap_pi(x);
    float sign = 1.0f;

    if (x > 0.5f * kPi) {
        x = kPi - x;
        sign = -1.0f;
    } else if (x < -0.5f * kPi) {
        x = -kPi - x;
        sign = -1.0f;
    }

    const float x2 = x * x;
    const float result = 1.0f + x2 * (-1.0f / 2.0f
        + x2 * (1.0f / 24.0f
        + x2 * (-1.0f / 720.0f
        + x2 * (1.0f / 40320.0f
        + x2 * (-1.0f / 3628800.0f
        + x2 * (1.0f / 479001600.0f))))));
    return sign * result;
}

static void clear_voice(Voice& voice) {
    voice.id = 0;
    voice.active = 0;
    voice.gate = 0;
    voice.frequency = 0.0f;
    voice.velocity = 0.0f;
    voice.envelope = 0.0f;
    voice.renorm_counter = 0;

    for (int harmonic = 0; harmonic < kHarmonics; ++harmonic) {
        voice.sin_state[harmonic] = 0.0f;
        voice.cos_state[harmonic] = 1.0f;
        voice.sin_delta[harmonic] = 0.0f;
        voice.cos_delta[harmonic] = 1.0f;
    }
}

__attribute__((visibility("default")))
void organ_init(float sample_rate) {
    if (sample_rate > 8000.0f) {
        g_sample_rate = sample_rate;
    }

    g_attack_step = 1.0f / (0.018f * g_sample_rate);
    g_release_step = 1.0f / (0.120f * g_sample_rate);
    g_registration = 0;

    for (int index = 0; index < kMaxVoices; ++index) {
        clear_voice(g_voices[index]);
    }

    for (int frame = 0; frame < kMaxBlock; ++frame) {
        g_output[frame] = 0.0f;
    }
}

__attribute__((visibility("default")))
void organ_set_registration(int registration) {
    if (registration < 0) registration = 0;
    if (registration > 2) registration = 2;
    g_registration = registration;
}

__attribute__((visibility("default")))
void organ_note_on(int voice_id, float frequency, float velocity) {
    Voice* selected = nullptr;

    for (int index = 0; index < kMaxVoices; ++index) {
        if (g_voices[index].active && g_voices[index].id == voice_id) {
            selected = &g_voices[index];
            break;
        }
    }

    if (!selected) {
        for (int index = 0; index < kMaxVoices; ++index) {
            if (!g_voices[index].active) {
                selected = &g_voices[index];
                break;
            }
        }
    }

    // Simple voice stealing when all voices are occupied.
    if (!selected) {
        selected = &g_voices[0];
    }

    clear_voice(*selected);
    selected->id = voice_id;
    selected->active = 1;
    selected->gate = 1;
    selected->frequency = frequency;
    selected->velocity = velocity;

    for (int harmonic = 0; harmonic < kHarmonics; ++harmonic) {
        const float harmonic_frequency = frequency * static_cast<float>(harmonic + 1);
        const float delta = kTwoPi * harmonic_frequency / g_sample_rate;
        selected->sin_delta[harmonic] = fast_sin(delta);
        selected->cos_delta[harmonic] = fast_cos(delta);
    }
}

__attribute__((visibility("default")))
void organ_note_off(int voice_id) {
    for (int index = 0; index < kMaxVoices; ++index) {
        Voice& voice = g_voices[index];
        if (voice.active && voice.id == voice_id) {
            voice.gate = 0;
        }
    }
}

__attribute__((visibility("default")))
void organ_all_notes_off() {
    for (int index = 0; index < kMaxVoices; ++index) {
        if (g_voices[index].active) {
            g_voices[index].gate = 0;
        }
    }
}

__attribute__((visibility("default")))
int organ_get_voice_count() {
    int count = 0;
    for (int index = 0; index < kMaxVoices; ++index) {
        if (g_voices[index].active) ++count;
    }
    return count;
}

__attribute__((visibility("default")))
int organ_get_output_buffer() {
    return static_cast<int>(reinterpret_cast<unsigned long>(&g_output[0]));
}

__attribute__((visibility("default")))
int organ_get_max_block_size() {
    return kMaxBlock;
}

__attribute__((visibility("default")))
void organ_render(int frames) {
    if (frames < 0) frames = 0;
    if (frames > kMaxBlock) frames = kMaxBlock;

    const float* registration = kRegistrations[g_registration];

    float normalization = 0.0f;
    for (int harmonic = 0; harmonic < kHarmonics; ++harmonic) {
        normalization += absf(registration[harmonic]);
    }
    if (normalization < 0.0001f) normalization = 1.0f;

    for (int frame = 0; frame < frames; ++frame) {
        float mixed = 0.0f;
        int active_count = 0;

        for (int voice_index = 0; voice_index < kMaxVoices; ++voice_index) {
            Voice& voice = g_voices[voice_index];
            if (!voice.active) continue;

            ++active_count;

            if (voice.gate) {
                voice.envelope += g_attack_step;
                if (voice.envelope > 1.0f) voice.envelope = 1.0f;
            } else {
                voice.envelope -= g_release_step;
                if (voice.envelope <= 0.0f) {
                    clear_voice(voice);
                    --active_count;
                    continue;
                }
            }

            float voice_sample = 0.0f;

            for (int harmonic = 0; harmonic < kHarmonics; ++harmonic) {
                const float harmonic_frequency = voice.frequency * static_cast<float>(harmonic + 1);
                if (harmonic_frequency >= 0.48f * g_sample_rate) continue;

                const float old_sin = voice.sin_state[harmonic];
                const float old_cos = voice.cos_state[harmonic];
                const float new_sin = old_sin * voice.cos_delta[harmonic]
                                    + old_cos * voice.sin_delta[harmonic];
                const float new_cos = old_cos * voice.cos_delta[harmonic]
                                    - old_sin * voice.sin_delta[harmonic];

                voice.sin_state[harmonic] = new_sin;
                voice.cos_state[harmonic] = new_cos;
                voice_sample += new_sin * registration[harmonic];
            }

            ++voice.renorm_counter;
            if (voice.renorm_counter >= 1024) {
                voice.renorm_counter = 0;
                for (int harmonic = 0; harmonic < kHarmonics; ++harmonic) {
                    const float sine = voice.sin_state[harmonic];
                    const float cosine = voice.cos_state[harmonic];
                    const float magnitude_squared = sine * sine + cosine * cosine;
                    // One Newton step for 1/sqrt(magnitude_squared), valid near 1.
                    const float scale = 1.5f - 0.5f * magnitude_squared;
                    voice.sin_state[harmonic] *= scale;
                    voice.cos_state[harmonic] *= scale;
                }
            }

            mixed += (voice_sample / normalization) * voice.velocity * voice.envelope;
        }

        // Approximate equal-power scaling as polyphony increases.
        float polyphony_scale = 1.0f;
        if (active_count > 1) polyphony_scale = 0.72f;
        if (active_count > 4) polyphony_scale = 0.52f;
        if (active_count > 8) polyphony_scale = 0.38f;

        g_output[frame] = mixed * polyphony_scale * 0.55f;
    }

    for (int frame = frames; frame < kMaxBlock; ++frame) {
        g_output[frame] = 0.0f;
    }
}

} // extern "C"
