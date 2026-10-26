export type WaveformState = 'idle' | 'ready' | 'gesture' | 'unavailable';
type AudioGraph = { context: AudioContext; source: MediaElementAudioSourceNode | null; analyser: AnalyserNode | null; failed?: boolean };
// A media element can only have one MediaElementAudioSourceNode in its lifetime.
// Keep its output graph alive across room component remounts, not a new source each time.
const graphs = new WeakMap<HTMLAudioElement, AudioGraph>();
export function releaseWaveformAudio(audio: HTMLAudioElement) {
  const graph = graphs.get(audio); if (!graph) return;
  graph.source?.disconnect(); graph.analyser?.disconnect();
  void graph.context.close().catch(() => {}); graphs.delete(audio);
}

/** Read the actual player directly through the Web Audio API, without captureStream. */
export class AudioWaveform {
  state: WaveformState = 'idle';
  private samples = new Float32Array(2048);
  private frequencies = new Uint8Array(1024);
  private disposed = false;
  private contextFailed = false;
  constructor(private audio: HTMLAudioElement | (() => HTMLAudioElement | null), private createContext = () => new AudioContext()) {}
  private currentAudio() { return typeof this.audio === 'function' ? this.audio() : this.audio; }
  async resume() {
    const audio = this.currentAudio(); if (this.disposed || !audio) return;
    try {
      let graph = graphs.get(audio);
      if (!graph) { graph = { context: this.createContext(), source: null, analyser: null }; graphs.set(audio, graph); }
      if (graph.context.state === 'suspended' || String(graph.context.state) === 'interrupted') await graph.context.resume();
      this.contextFailed = false;
    } catch { this.contextFailed = true; this.state = 'unavailable'; }
  }
  read(): Float32Array | null {
    const audio = this.currentAudio();
    if (this.disposed || !audio || audio.paused || audio.ended || audio.readyState < 3) { this.state = 'idle'; return null; }
    // Never route opaque (non-CORS) audio into Web Audio: that would silence it.
    if (audio.crossOrigin !== 'anonymous') { this.state = 'unavailable'; return null; }
    const graph = graphs.get(audio);
    if (this.contextFailed || graph?.failed) { this.state = 'unavailable'; return null; }
    if (!graph || graph.context.state !== 'running') { this.state = 'gesture'; return null; }
    try {
      if (!graph.source) {
        const analyser = graph.context.createAnalyser(); analyser.fftSize = this.samples.length;
        analyser.smoothingTimeConstant = .8;
        const source = graph.context.createMediaElementSource(audio);
        graph.source = source; graph.analyser = analyser;
        // The destination is essential: after attachment the media element plays through this graph.
        source.connect(graph.context.destination);
        source.connect(analyser);
      }
      graph.analyser!.getFloatTimeDomainData(this.samples);
      this.state = 'ready'; return this.samples;
    } catch { graph.failed = true; this.state = 'unavailable'; return null; }
  }
  readSpectrum(): { bins: Uint8Array; sampleRate: number } | null {
    if (!this.read()) return null;
    const audio = this.currentAudio(), graph = audio ? graphs.get(audio) : undefined;
    if (!graph?.analyser) return null;
    graph.analyser.getByteFrequencyData(this.frequencies);
    return { bins: this.frequencies, sampleRate: graph.context.sampleRate };
  }
  dispose() {
    // Stop reading only. Disconnecting/closing the shared output here would mute
    // background playback or break revisiting the same room.
    this.disposed = true; this.state = 'idle';
  }
}

/** Logarithmic frequency bands, so bass, vocals and treble all have visible space. */
export function spectrumLevels(bins: Uint8Array, sampleRate: number, count: number): Float32Array {
  const levels = new Float32Array(count);
  if (!bins.length || sampleRate <= 0) return levels;
  const hz = sampleRate / (bins.length * 2), low = Math.max(40, hz), high = Math.min(16000, sampleRate / 2);
  for (let i = 0; i < count; i++) {
    const start = Math.min(bins.length - 1, Math.floor(low * (high / low) ** (i / count) / hz));
    const end = Math.min(bins.length, Math.max(start + 1, Math.ceil(low * (high / low) ** ((i + 1) / count) / hz)));
    let peak = 0;
    for (let j = start; j < end; j++) peak = Math.max(peak, bins[j]!);
    levels[i] = peak / 255;
  }
  return levels;
}
