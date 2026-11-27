<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { loadStageArtwork } from '../bridge';
import { createStageArtworkLoader } from '../stage-artwork';
import { createRoomFlow } from '../room-flow-renderer';

const props = defineProps<{ roomId: string; trackId: string; coverUrl: string }>();
const canvas = ref<HTMLCanvasElement | null>(null);
const liveLayer = ref<HTMLElement | null>(null);
const previousCanvas = ref<HTMLCanvasElement | null>(null);
const previousLayer = ref<HTMLElement | null>(null);
const visible = ref(false);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let renderer: ReturnType<typeof createRoomFlow> = null;
let artwork: HTMLImageElement | null = null;
let artworkTrackId = '';
let fade: Animation | null = null;
let frame = 0;
let lastFrame = 0;

function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  lastFrame = 0;
}

function stopFade() {
  fade?.cancel();
  fade = null;
}

function animateOpacity(layer: HTMLElement, from: number, to: number) {
  const animation = layer.animate([{ opacity: from }, { opacity: to }], {
    duration: 420, easing: 'ease-in-out',
  });
  fade = animation;
  animation.onfinish = () => { if (fade === animation) fade = null; };
}

function capturePrevious() {
  const source = canvas.value, target = previousCanvas.value, layer = previousLayer.value;
  if (!visible.value || !source || !target || !layer || !renderer?.draw(0)) return false;
  // Sample the current composite on rapid skips so a new fade does not flash
  // back to the first frame of the previous transition.
  const opacity = fade?.effect instanceof KeyframeEffect && fade.effect.target === layer ? Number(getComputedStyle(layer).opacity) : 0;
  const snapshot = document.createElement('canvas');
  snapshot.width = source.width;
  snapshot.height = source.height;
  const context = snapshot.getContext('2d');
  const output = target.getContext('2d');
  if (!context || !output) return false;
  context.drawImage(source, 0, 0);
  if (opacity > 0) {
    context.globalAlpha = opacity;
    context.drawImage(target, 0, 0);
  }
  target.width = snapshot.width;
  target.height = snapshot.height;
  output.drawImage(snapshot, 0, 0);
  return true;
}

function tick(now: number) {
  frame = 0;
  if (!visible.value || document.hidden || reducedMotion.matches) return;
  if (!lastFrame || now - lastFrame >= 1000 / 30 - 1) {
    if (!renderer?.draw(lastFrame ? Math.min((now - lastFrame) / 1000, .05) : 0)) {
      visible.value = false;
      stopFade();
      return;
    }
    lastFrame = now;
  }
  frame = requestAnimationFrame(tick);
}

function syncAnimation() {
  stop();
  if (document.hidden || reducedMotion.matches) stopFade();
  if (visible.value && !document.hidden && !reducedMotion.matches) frame = requestAnimationFrame(tick);
}

function showArtwork() {
  if (!canvas.value || (!visible.value && !artwork)) return;
  const motion = !document.hidden && !reducedMotion.matches;
  const outgoing = motion && capturePrevious();
  stopFade();
  visible.value = false;
  if (artwork) {
    renderer ??= createRoomFlow(canvas.value);
    try {
      visible.value = !!renderer?.setImage(artwork) && renderer.draw(0);
    } catch {
      // Unsupported or failed artwork always leaves the room gradient usable.
    }
  }
  if (outgoing && previousLayer.value) animateOpacity(previousLayer.value, 1, 0);
  else if (motion && visible.value && liveLayer.value) animateOpacity(liveLayer.value, 0, 1);
  syncAnimation();
}

function setArtwork(image: HTMLImageElement | null) {
  artworkTrackId = image ? props.trackId : '';
  artwork = image;
  showArtwork();
}

const loader = createStageArtworkLoader(
  url => loadStageArtwork(props.roomId, props.trackId, url),
  image => { if (image) setArtwork(image); },
  undefined,
  () => { if (artworkTrackId !== props.trackId) setArtwork(null); },
);
watch(() => [props.roomId, props.trackId, props.coverUrl] as const, ([roomId, trackId, url]) => {
  // Keep the old artwork until the next cover decodes; missing covers fade to
  // the shell gradient instead of revealing an uninitialized canvas.
  if (!url) setArtwork(null);
  void loader.set(url, JSON.stringify([roomId, trackId]));
}, { immediate: true });

function contextLost(event: Event) {
  event.preventDefault();
  visible.value = false;
  stop();
  stopFade();
  renderer?.dispose();
  renderer = null;
}

onMounted(() => {
  document.addEventListener('visibilitychange', syncAnimation);
  reducedMotion.addEventListener('change', syncAnimation);
  showArtwork();
});
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', syncAnimation);
  reducedMotion.removeEventListener('change', syncAnimation);
  loader.dispose();
  stop();
  stopFade();
  renderer?.dispose();
});
</script>

<template>
  <div class="room-flow" aria-hidden="true">
    <div ref="liveLayer" class="room-flow-layer room-flow-live" :class="{ 'has-artwork': visible }">
      <canvas ref="canvas" @webglcontextlost="contextLost" @webglcontextrestored="showArtwork" />
    </div>
    <div ref="previousLayer" class="room-flow-layer room-flow-previous">
      <canvas ref="previousCanvas" />
    </div>
  </div>
</template>

<style scoped>
.room-flow {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}
.room-flow-layer {
  position: absolute;
  inset: 0;
}
.room-flow-live { visibility: hidden; }
.room-flow-live.has-artwork { visibility: visible; }
.room-flow-previous { opacity: 0; }
.room-flow canvas {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.room-flow-layer::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(246, 249, 255, .48);
}
</style>
