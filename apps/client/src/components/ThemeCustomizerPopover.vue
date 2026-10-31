<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { X, Disc, Smartphone, RotateCcw, Sparkles } from 'lucide-vue-next';
import {
  stageTheme,
  IPOD_PRESETS,
  LUMIERE_PRESETS,
  applyPreset,
  applyLumierePreset,
  TURNTABLE_VINYL_EDITIONS,
  TURNTABLE_PLINTH_COLORS
} from '../stage-theme';

const emit = defineEmits<{ close: [] }>();
const popoverRef = ref<HTMLElement | null>(null);

function close() {
  emit('close');
}

function selectPreset(key: string) {
  applyPreset(key);
}

function resetCustomColors() {
  applyPreset('u2');
}

function selectLumierePreset(key: string) {
  applyLumierePreset(key);
}

function resetLumiereColors() {
  applyLumierePreset('ocean');
}

const MOTION_CYCLE = ['calm', 'normal', 'chaotic'] as const;
const MOTION_LABELS: Record<string, string> = {
  calm: '轻柔（不散开）',
  normal: '均衡',
  chaotic: '热烈（大幅散开）'
};

const motionLabel = computed(() => MOTION_LABELS[stageTheme.lumiere.motion] ?? MOTION_LABELS.normal);

function cycleMotion() {
  const idx = MOTION_CYCLE.indexOf(stageTheme.lumiere.motion);
  stageTheme.lumiere.motion = MOTION_CYCLE[(idx + 1) % MOTION_CYCLE.length];
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

function handleDocClick(e: MouseEvent) {
  if (popoverRef.value && !popoverRef.value.contains(e.target as Node)) {
    close();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
  requestAnimationFrame(() => {
    document.addEventListener('click', handleDocClick);
  });
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  document.removeEventListener('click', handleDocClick);
});
</script>

<template>
  <div
    ref="popoverRef"
    class="theme-popover"
    role="region"
    aria-label="播放器模式与外观设置"
    @click.stop
  >
    <!-- 指向箭角 -->
    <div class="popover-arrow" aria-hidden="true" />

    <!-- 顶部极简标题与关闭 -->
    <header class="popover-top">
      <span class="popover-heading">播放器外观</span>
      <button type="button" class="close-btn" title="关闭" @click="close">
        <X :size="13" />
      </button>
    </header>

    <!-- 核心第一步：三选一 分段胶囊控制器 (Segmented Control) -->
    <div class="segmented-control">
      <button
        type="button"
        class="segment-btn"
        :class="{ active: stageTheme.mode === 'turntable' }"
        @click="stageTheme.mode = 'turntable'"
      >
        <Disc :size="13" />
        <span>经典黑胶</span>
      </button>

      <button
        type="button"
        class="segment-btn"
        :class="{ active: stageTheme.mode === 'ipod' }"
        @click="stageTheme.mode = 'ipod'"
      >
        <Smartphone :size="13" />
        <span>3D iPod</span>
      </button>

      <button
        type="button"
        class="segment-btn"
        :class="{ active: stageTheme.mode === 'lumiere' }"
        @click="stageTheme.mode = 'lumiere'"
      >
        <Sparkles :size="13" />
        <span>流光纯歌词</span>
      </button>
    </div>

    <!-- 形态 A：3D 留声机黑胶外观定制 -->
    <div v-if="stageTheme.mode === 'turntable'" class="ipod-config-pane turntable-config-pane">
      <!-- 唱片盘身工艺 -->
      <div class="config-section">
        <div class="section-meta">
          <span class="meta-label">黑胶工艺</span>
          <span class="preset-cur-name">{{ TURNTABLE_VINYL_EDITIONS[stageTheme.turntable.vinylEdition]?.name || '白金银' }}</span>
        </div>
        <div class="preset-dots-row">
          <button
            v-for="(v, key) in TURNTABLE_VINYL_EDITIONS"
            :key="key"
            type="button"
            class="preset-bubble"
            :class="{ active: stageTheme.turntable.vinylEdition === key }"
            :title="v.name"
            @click="stageTheme.turntable.vinylEdition = key"
          >
            <span
              class="bubble-color"
              :style="{ background: v.color }"
            />
          </button>
        </div>
      </div>

      <!-- 机身底座配色 -->
      <div class="config-section">
        <div class="section-meta">
          <span class="meta-label">底座机身</span>
          <span class="preset-cur-name">{{ TURNTABLE_PLINTH_COLORS[stageTheme.turntable.plinthColor]?.name || '陶瓷暖白' }}</span>
        </div>
        <div class="preset-dots-row">
          <button
            v-for="(p, key) in TURNTABLE_PLINTH_COLORS"
            :key="key"
            type="button"
            class="preset-bubble"
            :class="{ active: stageTheme.turntable.plinthColor === key }"
            :title="p.name"
            @click="stageTheme.turntable.plinthColor = key"
          >
            <span
              class="bubble-color"
              :style="{ background: p.color }"
            />
          </button>
        </div>
      </div>

      <!-- 转速与交互开关 -->
      <div class="config-section toggles-row">
        <label class="toggle-item">
          <input v-model="stageTheme.turntable.parallaxTilt" type="checkbox" />
          <span>悬浮视差微动</span>
        </label>
        <button
          type="button"
          class="speed-pill-btn"
          title="点击切换黑胶转速"
          @click="
            stageTheme.turntable.speed =
              stageTheme.turntable.speed === 3.3 ? 2.0 :
              stageTheme.turntable.speed === 2.0 ? 33.3 : 3.3
          "
        >
          <span>
            {{
              stageTheme.turntable.speed === 2.0 ? '沉浸慢转 (2.0 RPM)' :
              stageTheme.turntable.speed === 33.3 ? '物理原速 (33 ⅓ RPM)' :
              '惬意缓速 (3.3 RPM)'
            }}
          </span>
        </button>
      </div>
    </div>

    <!-- 形态 B：3D iPod 详细外观定制（紧凑展开） -->
    <div v-else-if="stageTheme.mode === 'ipod'" class="ipod-config-pane">
      <!-- 预设色彩选项条 -->
      <div class="config-section">
        <div class="section-meta">
          <span class="meta-label">配色预设</span>
          <span class="preset-cur-name">{{ IPOD_PRESETS[stageTheme.ipod.preset]?.name || '自定义' }}</span>
        </div>
        <div class="preset-dots-row">
          <button
            v-for="(p, key) in IPOD_PRESETS"
            :key="key"
            type="button"
            class="preset-bubble"
            :class="{ active: stageTheme.ipod.preset === key }"
            :title="p.name"
            @click="selectPreset(String(key))"
          >
            <span
              class="bubble-color"
              :style="{ background: p.bodyColor, borderColor: p.wheelColor }"
            />
          </button>
        </div>
      </div>

      <!-- 调色盘微调（横排紧凑色片） -->
      <div class="config-section">
        <div class="section-meta">
          <span class="meta-label">细节调色</span>
          <button type="button" class="reset-btn" title="重置为默认配色" @click="resetCustomColors">
            <RotateCcw :size="11" /> 重置
          </button>
        </div>
        <div class="color-wells-strip">
          <label class="well-chip" title="点击选择机身外壳颜色">
            <span class="chip-dot" :style="{ background: stageTheme.ipod.bodyColor }" />
            <span class="chip-name">机身</span>
            <code class="chip-hex">{{ stageTheme.ipod.bodyColor.toUpperCase() }}</code>
            <input
              v-model="stageTheme.ipod.bodyColor"
              type="color"
              @input="stageTheme.ipod.preset = 'custom'"
            />
          </label>

          <label class="well-chip" title="点击选择转轮颜色">
            <span class="chip-dot" :style="{ background: stageTheme.ipod.wheelColor }" />
            <span class="chip-name">转轮</span>
            <code class="chip-hex">{{ stageTheme.ipod.wheelColor.toUpperCase() }}</code>
            <input
              v-model="stageTheme.ipod.wheelColor"
              type="color"
              @input="stageTheme.ipod.preset = 'custom'"
            />
          </label>

          <label class="well-chip" title="点击选择按键颜色">
            <span class="chip-dot" :style="{ background: stageTheme.ipod.buttonColor }" />
            <span class="chip-name">按键</span>
            <code class="chip-hex">{{ stageTheme.ipod.buttonColor.toUpperCase() }}</code>
            <input
              v-model="stageTheme.ipod.buttonColor"
              type="color"
              @input="stageTheme.ipod.preset = 'custom'"
            />
          </label>
        </div>
      </div>

      <!-- 交互与律动开关 -->
      <div class="config-section toggles-row">
        <label class="toggle-item">
          <input v-model="stageTheme.ipod.parallaxTilt" type="checkbox" />
          <span>悬浮视差微动</span>
        </label>
        <label class="toggle-item">
          <input v-model="stageTheme.ipod.beatPulse" type="checkbox" />
          <span>音乐轻微律动</span>
        </label>
      </div>
    </div>

    <!-- 形态 C：流光纯歌词配色与动效定制 -->
    <div v-else class="ipod-config-pane lumiere-config-pane">
      <!-- 配色预设 -->
      <div class="config-section">
        <div class="section-meta">
          <span class="meta-label">流光配色</span>
          <span class="preset-cur-name">{{ LUMIERE_PRESETS[stageTheme.lumiere.preset]?.name || '自定义' }}</span>
        </div>
        <div class="preset-dots-row">
          <button
            v-for="(p, key) in LUMIERE_PRESETS"
            :key="key"
            type="button"
            class="preset-bubble"
            :class="{ active: stageTheme.lumiere.preset === key }"
            :title="p.name"
            @click="selectLumierePreset(String(key))"
          >
            <span
              class="bubble-color"
              :style="{ background: p.primary, borderColor: p.secondary }"
            />
          </button>
        </div>
      </div>

      <!-- 细节调色 -->
      <div class="config-section">
        <div class="section-meta">
          <span class="meta-label">细节调色</span>
          <button type="button" class="reset-btn" title="重置为流光蓝" @click="resetLumiereColors">
            <RotateCcw :size="11" /> 重置
          </button>
        </div>
        <div class="color-wells-strip">
          <label class="well-chip" title="正在演唱的字与内环光晕">
            <span class="chip-dot" :style="{ background: stageTheme.lumiere.primary }" />
            <span class="chip-name">主色</span>
            <code class="chip-hex">{{ stageTheme.lumiere.primary.toUpperCase() }}</code>
            <input
              v-model="stageTheme.lumiere.primary"
              type="color"
              @input="stageTheme.lumiere.preset = 'custom'"
            />
          </label>

          <label class="well-chip" title="外环光晕与环境光斑">
            <span class="chip-dot" :style="{ background: stageTheme.lumiere.secondary }" />
            <span class="chip-name">副色</span>
            <code class="chip-hex">{{ stageTheme.lumiere.secondary.toUpperCase() }}</code>
            <input
              v-model="stageTheme.lumiere.secondary"
              type="color"
              @input="stageTheme.lumiere.preset = 'custom'"
            />
          </label>

          <label class="well-chip" title="未唱与已唱的字">
            <span class="chip-dot" :style="{ background: stageTheme.lumiere.base }" />
            <span class="chip-name">基色</span>
            <code class="chip-hex">{{ stageTheme.lumiere.base.toUpperCase() }}</code>
            <input
              v-model="stageTheme.lumiere.base"
              type="color"
              @input="stageTheme.lumiere.preset = 'custom'"
            />
          </label>
        </div>
      </div>

      <!-- 动效强度 -->
      <div class="config-section">
        <div class="section-meta">
          <span class="meta-label">动效强度</span>
          <button type="button" class="speed-pill-btn" title="点击切换逐字散开与呼吸幅度" @click="cycleMotion">
            <span>{{ motionLabel }}</span>
          </button>
        </div>
      </div>

      <!-- 动效开关 -->
      <div class="config-section toggles-row">
        <label class="toggle-item">
          <input v-model="stageTheme.lumiere.sweep" type="checkbox" />
          <span>逐字流光扫过</span>
        </label>
        <label class="toggle-item">
          <input v-model="stageTheme.lumiere.depthBlur" type="checkbox" />
          <span>景深散焦浮现</span>
        </label>
        <label class="toggle-item">
          <input v-model="stageTheme.lumiere.breathing" type="checkbox" />
          <span>整行呼吸漂浮</span>
        </label>
      </div>

      <!-- 词间距 -->
      <div class="config-section">
        <div class="section-meta">
          <span class="meta-label">词间距</span>
          <span class="preset-cur-name">{{ stageTheme.lumiere.wordSpacing.toFixed(1) }}</span>
        </div>
        <input
          v-model.number="stageTheme.lumiere.wordSpacing"
          class="spacing-range"
          type="range"
          min="0"
          max="2"
          step="0.1"
          aria-label="词间距倍率"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.theme-popover {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: 296px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(28px) saturate(190%);
  -webkit-backdrop-filter: blur(28px) saturate(190%);
  border: 1px solid rgba(225, 232, 240, 0.95);
  border-radius: 16px;
  box-shadow:
    0 16px 36px -6px rgba(35, 52, 75, 0.16),
    0 3px 10px rgba(35, 52, 75, 0.04),
    0 0 0 1px rgba(255, 255, 255, 0.8) inset;
  color: #283448;
  z-index: 100;
  padding: 12px 14px 14px;
  user-select: none;
  animation: popover-in 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  box-sizing: border-box;
}

@keyframes popover-in {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.popover-arrow {
  position: absolute;
  top: -5px;
  right: 24px;
  width: 10px;
  height: 10px;
  background: #ffffff;
  border-left: 1px solid rgba(225, 232, 240, 0.95);
  border-top: 1px solid rgba(225, 232, 240, 0.95);
  transform: rotate(45deg);
  border-top-left-radius: 2px;
  z-index: 2;
}

.popover-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.popover-heading {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  letter-spacing: -0.2px;
}

.close-btn {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: transparent;
  color: #8c9ba8;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  padding: 0;
}

.close-btn:hover {
  background: #eef2f6;
  color: #1e293b;
}

/* 核心：分段控制器 Segmented Control */
.segmented-control {
  display: flex;
  background: #eef3f8;
  padding: 3px;
  border-radius: 10px;
  gap: 3px;
  margin-bottom: 12px;
}

.segment-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  padding: 0 4px;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.segment-btn:hover:not(.active) {
  color: #1e293b;
}

.segment-btn.active {
  background: #ffffff;
  color: #16a34a;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(35, 52, 75, 0.08);
}

/* 流光配置面板复用 ipod-config-pane 的分区 / 色片 / 开关样式 */
.spacing-range {
  width: 100%;
  accent-color: #16a34a;
  cursor: pointer;
}

/* 黑胶紧凑介绍 */
.turntable-preview-pane {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: #f8fafc;
  border-radius: 12px;
  border: 1px solid #eef2f6;
}

.vinyl-disc-wrap {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #18181b;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

.vinyl-mini-disc {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #d61b24;
  border: 2px solid #18181b;
}

.turntable-desc strong {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 2px;
}

.turntable-desc p {
  margin: 0;
  font-size: 10.5px;
  color: #798799;
  line-height: 1.4;
}

/* iPod 展开定制面板 */
.ipod-config-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 10px;
  border-bottom: 1px solid #edf1f6;
}

.config-section.no-border {
  border-bottom: none;
  padding-bottom: 0;
}

.section-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.meta-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  letter-spacing: 0.2px;
}

.preset-cur-name {
  font-size: 11px;
  font-weight: 500;
  color: #16a34a;
}

.reset-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: transparent;
  border: none;
  font-size: 10px;
  color: #16a34a;
  cursor: pointer;
  padding: 1px 4px;
  border-radius: 4px;
}

.reset-btn:hover {
  text-decoration: underline;
}

/* 配色预设圆气泡 */
.preset-dots-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preset-bubble {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1.5px solid transparent;
  background: transparent;
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.preset-bubble:hover {
  transform: scale(1.1);
}

.preset-bubble.active {
  border-color: #16a34a;
  box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.2);
}

.bubble-color {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border-width: 3px;
  border-style: solid;
  box-sizing: border-box;
}

/* 调色盘色片 */
.color-wells-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.well-chip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 6px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  overflow: hidden;
}

.well-chip:hover {
  border-color: #16a34a;
  background: #ffffff;
}

.well-chip input[type='color'] {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  cursor: pointer;
  padding: 0;
  margin: 0;
}

.chip-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.12);
  flex-shrink: 0;
}

.chip-name {
  font-size: 10px;
  color: #64748b;
  font-weight: 500;
}

.chip-hex {
  margin-left: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 8.5px;
  color: #94a3b8;
}


.toggles-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.toggle-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #475569;
  cursor: pointer;
}

.speed-pill-btn {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 4px 10px;
  font-size: 10px;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
  transition: all 0.2s;
}

.speed-pill-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}
</style>
