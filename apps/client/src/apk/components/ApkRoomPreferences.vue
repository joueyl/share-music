<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { Search, Settings2, Square, X } from 'lucide-vue-next';
import { stageTheme, type StageMode } from '../../stage-theme';
import { useDialogFocus } from '../../useDialogFocus';
import { useDialogDismiss } from '../../useDialogDismiss';
import { apkRoomLayoutKey } from '../room-layout';
import { describePlaybackDiagnostic, enablePlaybackDiagnostic, playbackDiagnosticEnabled, playbackDiagnosticEntries } from '../playback-diagnostic';

defineProps<{ canEdit: boolean; canStop: boolean; volume: number }>();
const emit = defineEmits<{ close: []; edit: []; stop: []; volumeInput: [value: number]; library: []; search: [] }>();
const dialog = ref<HTMLElement | null>(null);
const layout = inject(apkRoomLayoutKey)!;
const mode = computed<StageMode | 'vinyl'>({
  get: () => stageTheme.mode === 'turntable' && !layout.threeD.value ? 'vinyl' : stageTheme.mode,
  set: (value) => {
    layout.threeD.value = value === 'turntable';
    layout.lyrics.value = false;
    stageTheme.mode = value === 'vinyl' ? 'turntable' : value;
  },
});
const { dialogVisible, dismiss, finishDismiss } = useDialogDismiss(() => emit('close'), () => true);
useDialogFocus(dialog, dismiss);
</script>

<template>
  <Teleport to="body">
    <Transition name="apk-room-dialog" appear @after-leave="finishDismiss">
    <div v-show="dialogVisible" class="modal-backdrop" @click.self="dismiss">
      <section ref="dialog" class="tone-dialog apk-room-preferences" role="dialog" aria-modal="true" aria-label="一起听设置" :inert="!dialogVisible">
        <header class="dialog-heading">
          <h2>一起听设置</h2>
          <button class="round-close" aria-label="关闭一起听设置" @click="dismiss"><X :size="20" /></button>
        </header>
        <label>舞台外观
          <select v-model="mode">
            <option value="vinyl">沉浸唱片</option>
            <option value="turntable">3D 唱机</option>
            <option value="ipod">iPod</option>
            <option value="lumiere">流光歌词</option>
          </select>
        </label>
        <label>本地音量
          <input :value="volume" type="range" min="0" max="1" step=".01" @input="emit('volumeInput', Number(($event.target as HTMLInputElement).value))" />
        </label>
        <button class="secondary" :disabled="!canStop" @click="emit('stop')"><Square :size="16" />停止播放</button>
        <button class="secondary" @click="emit('search')"><Search :size="16" />搜索音乐</button>
        <button class="secondary" @click="emit('library')">共享音乐库</button>
        <button v-if="canEdit" class="primary" @click="emit('edit')"><Settings2 :size="18" />房间设置</button>
        <button class="secondary" :aria-pressed="playbackDiagnosticEnabled" @click="enablePlaybackDiagnostic(!playbackDiagnosticEnabled)">
          {{ playbackDiagnosticEnabled ? '关闭音频诊断' : '开启音频诊断' }}
        </button>
        <section v-if="playbackDiagnosticEnabled" class="apk-playback-diagnostic" aria-label="音频诊断记录" data-selectable>
          <p>只记录本机最近 8 条播放事件。关闭诊断或离开房间会清空。</p>
          <p v-if="!playbackDiagnosticEntries.length">暂无事件。可关闭设置继续播放，复现后再打开查看。</p>
          <ul v-else>
            <li v-for="entry in playbackDiagnosticEntries" :key="entry.id">{{ entry.at }} · {{ describePlaybackDiagnostic(entry.event) }}</li>
          </ul>
        </section>
      </section>
    </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.apk-playback-diagnostic{font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.apk-playback-diagnostic p{margin:0 0 6px}
.apk-playback-diagnostic ul{padding-inline-start:1.4em;margin:0}
</style>
