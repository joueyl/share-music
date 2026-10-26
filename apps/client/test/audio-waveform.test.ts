import { expect, it, vi } from 'vitest';
import { AudioWaveform, releaseWaveformAudio, spectrumLevels } from '../src/audio-waveform';

function setup() {
  const audio = { paused: false, ended: false, readyState: 3, crossOrigin: 'anonymous' } as unknown as HTMLAudioElement;
  const analyser = { fftSize: 0, disconnect: vi.fn(), getByteFrequencyData: vi.fn((bins: Uint8Array) => { bins.fill(0); bins[8] = 255; }), getFloatTimeDomainData: vi.fn((samples: Float32Array) => { samples.fill(0); samples[1] = .5; samples[2] = -.25; }) };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const context = { state: 'running', sampleRate: 48000, destination: {}, resume: vi.fn(async () => { context.state = 'running'; }), close: vi.fn(async () => {}), createAnalyser: vi.fn(() => analyser), createMediaElementSource: vi.fn(() => source) };
  const create = vi.fn(() => context as unknown as AudioContext);
  const reader = new AudioWaveform(audio, create);
  return { reader, audio, context, source, analyser, create };
}
it('connects the actual media element directly to its output and analyser and reads real PCM', async () => {
  const f = setup(); await f.reader.resume(); const samples = f.reader.read()!;
  expect(samples).toHaveLength(2048); expect(samples[1]).toBe(.5); expect(samples[2]).toBe(-.25);
  expect(f.reader.state).toBe('ready');
  expect(f.context.createMediaElementSource).toHaveBeenCalledExactlyOnceWith(f.audio);
  expect(f.source.connect.mock.calls).toEqual([[f.context.destination],[f.analyser]]);
  f.reader.read(); expect(f.context.createMediaElementSource).toHaveBeenCalledOnce();
  releaseWaveformAudio(f.audio);
});
it('does not attach opaque audio or synthesize samples while paused or buffering', async () => {
  const f = setup(); await f.reader.resume();
  f.audio.paused = true; expect(f.reader.read()).toBeNull(); expect(f.reader.state).toBe('idle');
  f.audio.paused = false; f.audio.readyState = 1; expect(f.reader.read()).toBeNull();
  f.audio.readyState = 3; f.audio.crossOrigin = null; expect(f.reader.read()).toBeNull();
  expect(f.reader.state).toBe('unavailable'); expect(f.context.createMediaElementSource).not.toHaveBeenCalled();
  releaseWaveformAudio(f.audio);
});
it('waits for gesture permission before rerouting audio so a suspended context cannot mute it', async () => {
  const f = setup(); expect(f.reader.read()).toBeNull(); expect(f.reader.state).toBe('gesture');
  f.context.state = 'suspended'; await f.reader.resume(); expect(f.context.resume).toHaveBeenCalledOnce();
  expect(f.reader.read()).not.toBeNull(); releaseWaveformAudio(f.audio);
});
it('reuses the same graph after remount and does not disconnect background playback', async () => {
  const f = setup(); await f.reader.resume(); f.reader.read(); f.reader.dispose();
  expect(f.context.close).not.toHaveBeenCalled(); expect(f.source.disconnect).not.toHaveBeenCalled();
  const second = new AudioWaveform(f.audio, f.create); await second.resume();
  expect(second.read()![1]).toBe(.5); expect(f.context.createMediaElementSource).toHaveBeenCalledOnce(); expect(f.create).toHaveBeenCalledOnce();
  second.dispose(); releaseWaveformAudio(f.audio); expect(f.context.close).toHaveBeenCalledOnce(); expect(f.source.disconnect).toHaveBeenCalledOnce();
});
it('follows a replaced playback element and frees the previous graph without reading stale data', async () => {
  const a = setup(), b = setup(); let current = a.audio;
  const reader = new AudioWaveform(() => current, a.create); await reader.resume(); reader.read();
  releaseWaveformAudio(a.audio); current = b.audio; b.audio.crossOrigin = null;
  expect(reader.read()).toBeNull(); expect(reader.state).toBe('unavailable'); expect(a.context.close).toHaveBeenCalledOnce();
  reader.dispose(); expect(reader.read()).toBeNull();
});
it('does not repeatedly try to bind a source when the environment rejects it', async () => {
  const f = setup(); await f.reader.resume();
  f.context.createMediaElementSource.mockImplementation(() => { throw new Error('InvalidStateError'); });
  expect(f.reader.read()).toBeNull(); expect(f.reader.read()).toBeNull();
  expect(f.reader.state).toBe('unavailable'); expect(f.context.createMediaElementSource).toHaveBeenCalledOnce();
  releaseWaveformAudio(f.audio);
});

it('reads frequency bins for real-time bars and preserves silence without synthetic levels', async () => {
  const f = setup(); await f.reader.resume();
  const spectrum = f.reader.readSpectrum()!;
  expect(spectrum.sampleRate).toBe(48000); expect(spectrum.bins[8]).toBe(255);
  const levels = spectrumLevels(spectrum.bins, spectrum.sampleRate, 64);
  expect(levels).toHaveLength(64); expect(Math.max(...levels)).toBe(1); expect(levels.some(value => value === 0)).toBe(true);
  expect([...spectrumLevels(new Uint8Array(1024), 44100, 64)].every(value => value === 0)).toBe(true);
  f.audio.paused = true; expect(f.reader.readSpectrum()).toBeNull(); releaseWaveformAudio(f.audio);
});
