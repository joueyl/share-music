<script setup lang="ts">
import AlbumArt from '../../components/AlbumArt.vue';

defineProps<{ cover?: string | null; playing: boolean; active: boolean }>();
</script>

<template>
  <div class="vinyl-artwork" aria-hidden="true">
    <div class="vinyl-disc" :class="{'is-spinning':playing&&active}">
      <div class="vinyl-label">
        <AlbumArt :src="cover" alt="" />
      </div>
    </div>
    <svg class="vinyl-arm" viewBox="0 0 342 386" fill="none" focusable="false">
      <circle cx="170" cy="16" r="15" fill="#F6FBFF" fill-opacity=".75"/>
      <g class="vinyl-tonearm" :class="{'is-playing':playing}">
        <path d="M171 17C213 83 214 85 313 107" stroke="#8BA2B5" stroke-opacity=".55" stroke-width="9" stroke-linecap="round"/>
        <path d="M171 17C213 83 214 85 313 107" stroke="#F8FCFF" stroke-width="5" stroke-linecap="round"/>
        <rect x="308" y="101" width="19" height="31" rx="5" fill="#F8FCFF" stroke="#AEBFCD" transform="rotate(12 308 101)"/>
      </g>
      <circle cx="170" cy="16" r="8" fill="#F8FCFF" stroke="#ABBFCE"/>
      <circle cx="170" cy="16" r="3" fill="#9CB1C2"/>
    </svg>
  </div>
</template>

<style scoped>
.vinyl-artwork{position:relative;width:100%;aspect-ratio:342/386;pointer-events:none}
.vinyl-disc{position:absolute;inset:auto 1.5% 0;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:repeating-radial-gradient(circle at center,#ffffff32 0 1px,transparent 2px 4px),conic-gradient(from 26deg,#dee8e9,#aec4d3 27%,#cad9e1 40%,#eaf0ea 60%,#aebfcd 84%,#dee8e9);border:1px solid #ffffffe0;box-shadow:0 14px 36px #68849a24,inset 0 0 0 4px #f6fdff4d}
.vinyl-label{position:relative;width:64%;aspect-ratio:1;border-radius:50%;overflow:hidden;background:#fbfcf8}
.vinyl-label :deep(.album-art){position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover}
.vinyl-arm{position:absolute;inset:0;width:100%;height:100%;filter:drop-shadow(0 2px 2px #60788840)}
.vinyl-tonearm{transform-box:view-box;transform-origin:170px 16px;transform:rotate(0deg)}
.vinyl-tonearm.is-playing{transform:rotate(14deg)}
@media(prefers-reduced-motion:no-preference){
  .vinyl-disc{animation:apk-vinyl-spin 9s linear infinite paused}
  .vinyl-disc.is-spinning{animation-play-state:running}
  .vinyl-tonearm{transition:transform calc(var(--motion-normal) * 2) cubic-bezier(.4,0,.25,1)}
  .vinyl-tonearm.is-playing{transition-duration:calc(var(--motion-normal) * 3)}
}
@keyframes apk-vinyl-spin{to{transform:rotate(1turn)}}
</style>
