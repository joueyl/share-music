<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { createPlaybackWaveform } from '../bridge';
import type { WaveformState } from '../audio-waveform';
import { spectrumLevels } from '../audio-waveform';

const props = defineProps<{ playing: boolean; sourceId?: string | null }>();
const canvas = ref<HTMLCanvasElement | null>(null), state = ref<WaveformState>('idle');
let reader: ReturnType<typeof createPlaybackWaveform> = null, observer: ResizeObserver | null = null;
let frame = 0, lastFrame = 0, width = 0, height = 0, disposed = false;
let reduced: MediaQueryList | null = null;
function clear() { const c = canvas.value; if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height); }
function draw() {
  const context = canvas.value?.getContext('2d'); if (!context || !reader) return;
  clear();
  const spectrum = reader.readSpectrum(); state.value = reader.state;
  if (!spectrum || !width || !height) return;
  const columns = Math.max(16, Math.min(96, Math.floor(width / 14)));
  const levels = spectrumLevels(spectrum.bins, spectrum.sampleRate, columns);
  const gap = 4, barWidth = Math.max(1, width / columns - gap), baseline = height * .82, maxHeight = height * .68;
  const gradient = context.createLinearGradient(0, baseline - maxHeight, 0, baseline);
  gradient.addColorStop(0, '#d2efa6cc'); gradient.addColorStop(.55, '#93cc9b88'); gradient.addColorStop(1, '#59a58b18');
  context.fillStyle = gradient;
  for (let i = 0; i < columns; i++) {
    const barHeight = Math.max(2, levels[i]! ** 1.3 * maxHeight), x = i * width / columns + gap / 2;
    context.beginPath(); context.roundRect(x, baseline - barHeight, barWidth, barHeight, Math.min(3, barWidth / 2, barHeight / 2)); context.fill();
  }
}
function tick(now: number) {
  frame = 0;
  if (disposed || document.hidden || !props.playing) return;
  if (now - lastFrame >= (reduced?.matches ? 1000 : 1000 / 30)) { draw(); lastFrame = now; }
  if (!reduced?.matches || state.value === 'idle') frame = requestAnimationFrame(tick);
}
function restart() {
  cancelAnimationFrame(frame); frame = 0; clear();
  if (!disposed && !document.hidden && props.playing) { lastFrame = 0; frame = requestAnimationFrame(tick); }
  else state.value = 'idle';
}
function wake() { void reader?.resume().then(() => { if (!disposed) restart(); }); }
watch(() => [props.playing, props.sourceId], () => { if (props.playing) wake(); else restart(); });
onMounted(() => {
  reader = createPlaybackWaveform(); reduced = matchMedia('(prefers-reduced-motion: reduce)');
  observer = new ResizeObserver(([entry]) => {
    if (!entry || !canvas.value) return;
    width = entry.contentRect.width; height = entry.contentRect.height;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.value.width = Math.round(width * ratio); canvas.value.height = Math.round(height * ratio);
    canvas.value.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0); restart();
  });
  if (canvas.value) observer.observe(canvas.value);
  document.addEventListener('pointerdown', wake, { passive: true }); document.addEventListener('keydown', wake);
  document.addEventListener('visibilitychange', restart); reduced.addEventListener('change', restart);
  wake();
});
onUnmounted(() => {
  disposed = true; cancelAnimationFrame(frame); observer?.disconnect(); reader?.dispose();
  document.removeEventListener('pointerdown', wake); document.removeEventListener('keydown', wake);
  document.removeEventListener('visibilitychange', restart); reduced?.removeEventListener('change', restart);
});
</script>
<template>
  <div class="room-waveform" aria-hidden="true"><canvas ref="canvas" /></div>
  <p v-if="playing && state === 'gesture'" class="waveform-note">点击页面启用实时波形</p>
  <p v-else-if="playing && state === 'unavailable'" class="waveform-note">当前音源无法读取波形，请重启客户端以更新本地音频模块</p>
</template>
