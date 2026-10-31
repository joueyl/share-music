<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Crown, Link, X, Settings2, Music } from 'lucide-vue-next';
import { useApp } from '../store';
import { ui, openSearch } from '../ui';
import { stageTheme, lumiereCssVars } from '../stage-theme';
import * as bridge from '../bridge';
import RoomChat from '../components/RoomChat.vue';
import SimilarRecommendations from '../components/SimilarRecommendations.vue';
import RoomWaveform from '../components/RoomWaveform.vue';
import TrackLyrics from '../components/TrackLyrics.vue';
import AlbumArt from '../components/AlbumArt.vue';
import IpodStage from '../components/IpodStage.vue';
import TurntableStage from '../components/TurntableStage.vue';
import turntable from '../assets/room-turntable.png';

const app = useApp();
const route = useRoute();
const router = useRouter();
const leaving = ref(false);
const resolvedCover = ref('');

const track = computed(() => app.room?.playlist.find((t) => t.id === app.room?.playback.sourceId));
const coverUrl = computed(() => bridge.playingTrackCover(track.value) || resolvedCover.value);
const online = computed(() => app.room?.members.filter((m) => m.online) ?? []);
const hostMember = computed(() => app.room?.members.find((m) => m.id === app.room?.hostId));
const sortedOnline = computed(() => {
  const members = [...online.value];
  const hostId = app.room?.hostId;
  return members.sort((a, b) => {
    if (a.id === hostId) return -1;
    if (b.id === hostId) return 1;
    return 0;
  });
});

watch(
  () => [app.room?.id, track.value?.id, track.value?.contentHash],
  async (_, __, onCleanup) => {
    let active = true;
    onCleanup(() => {
      active = false;
    });
    resolvedCover.value = '';
    const roomId = app.room?.id;
    const song = track.value;
    if (roomId && song && !bridge.playingTrackCover(song)) {
      const cover = await bridge.loadTrackCover(roomId, song);
      if (active) resolvedCover.value = cover;
    }
  },
  { immediate: true }
);

onMounted(async () => {
  try {
    if (app.room?.id !== route.params.id) {
      await bridge.join(String(route.params.id));
    }
  } catch (e) {
    app.error(e);
  }
});

async function exit() {
  if (leaving.value) return;
  leaving.value = true;
  try {
    await app.exitRoom();
    await router.push('/');
  } finally {
    leaving.value = false;
  }
}

async function invite() {
  const code = app.room?.inviteCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    app.notice = '房间码已复制，请私下分享给朋友';
  } catch {
    app.notice = `房间码：${code}，请手动复制并私下分享`;
  }
}
</script>

<template>
  <section v-if="app.room" class="tone-room page in-room-stage-page">
    <div class="listening-layout">
      <div class="listening-main">
        <section
          class="listening-stage"
          :class="{
            'ipod-active': stageTheme.mode === 'ipod',
            'turntable-active': stageTheme.mode === 'turntable',
            'lumiere-active': stageTheme.mode === 'lumiere'
          }"
          aria-label="一起听主舞台"
        >
          <RoomWaveform
            :key="app.room.id"
            :source-id="app.room.playback.sourceId"
            :playing="!!track && app.connected && app.room.playback.playState === 'playing'"
          />
          <!-- 右上角成员头像与房主控制播放指示（所有模式均展示） -->
          <div class="stage-top-presence">
            <button
              class="stage-controller-badge"
              aria-label="查看房间成员与播放权限"
              title="点击查看房间成员与播放控制权限"
              @click="ui.members = true"
            >
              <span class="controller-info">
                <Crown :size="14" class="crown-icon" />
                <span class="controller-name">{{ hostMember?.name ?? '房主' }}</span>
                <span class="controller-tag">控制播放</span>
              </span>
              <span class="stage-avatars">
                <span
                  v-for="member in sortedOnline.slice(0, 4)"
                  :key="member.id"
                  class="portrait"
                  :class="{ 'is-host': member.id === app.room?.hostId }"
                  :title="member.name + (member.id === app.room?.hostId ? '（房主 · 正在控制播放）' : '')"
                >
                  {{ member.name.slice(0, 1) }}
                  <span v-if="member.id === app.room?.hostId" class="host-badge">
                    <Crown :size="9" />
                  </span>
                </span>
                <small v-if="sortedOnline.length > 4">+{{ sortedOnline.length - 4 }}</small>
              </span>
            </button>
          </div>

          <!-- 舞台核心播放器：根据皮肤模式自由切换 -->
          <!-- 模式 1 & 2：3D黑胶唱机与 3D iPod -->
          <template v-if="stageTheme.mode !== 'lumiere'">
            <div v-if="stageTheme.mode === 'turntable'" class="stage-turntable-wrap">
              <TurntableStage :track="track" :cover-url="coverUrl" />
            </div>
            <div v-else class="stage-ipod-wrap">
              <IpodStage :track="track" :cover-url="coverUrl" />
            </div>

            <div class="stage-song">
              <div class="stage-song-title">
                <h2>{{ track?.name ?? '等待第一首音乐' }}</h2>
                <span v-if="track" class="source-badge">{{ track.lossless ? 'HQ' : '原音' }}</span>
              </div>
              <p>
                {{ track?.artists ?? '添加一首收藏，开始共享' }}
                <template v-if="track?.album"> / {{ track.album }}</template>
              </p>
              <TrackLyrics class="stage-lyrics" />
              <p v-if="!track" class="stage-empty-lyric">
                让音乐，替我们说声你好。
                <button class="text-button" :disabled="!app.connected || !app.permission.enqueue" @click="openSearch">
                  搜索想一起听的歌
                </button>
              </p>
            </div>
          </template>

          <!-- 模式 3：流光纯歌词全新形态 (Lumiere Pure Lyrics Stage) -->
          <template v-else>
            <div class="stage-lumiere-wrap" :style="lumiereCssVars(stageTheme.lumiere)">
              <!-- 灵动动态环境光晕背景 -->
              <div class="lumiere-ambient-glow" aria-hidden="true">
                <div class="ambient-orb orb-primary" />
                <div class="ambient-orb orb-secondary" />
              </div>

              <!-- 顶部曲目与歌手精致横幅 -->
              <div class="lumiere-song-header">
                <div class="lumiere-song-cover">
                  <AlbumArt v-if="coverUrl" class="lumiere-cover-art" :src="coverUrl" :alt="`${track?.name ?? ''}专辑封面`" />
                  <div v-else class="lumiere-cover-fallback">
                    <Music :size="20" />
                  </div>
                </div>
                <div class="lumiere-song-meta">
                  <div class="lumiere-title-row">
                    <h2 class="lumiere-title">{{ track?.name ?? '等待第一首音乐' }}</h2>
                    <span v-if="track" class="source-badge">{{ track.lossless ? 'HQ' : '原音' }}</span>
                  </div>
                  <p class="lumiere-artist">
                    {{ track?.artists ?? '添加一首收藏，开始共享' }}
                    <template v-if="track?.album"> · {{ track.album }}</template>
                  </p>
                </div>
              </div>

              <!-- 全景流光歌词展示区 -->
              <div class="lumiere-lyrics-container">
                <TrackLyrics variant="lumiere" class="lumiere-stage-lyrics" />
                <p v-if="!track" class="stage-empty-lyric lumiere-empty-lyric">
                  流光纯歌词待启，让音乐替我们说声你好。
                  <button class="text-button" :disabled="!app.connected || !app.permission.enqueue" @click="openSearch">
                    搜索想一起听的歌
                  </button>
                </p>
              </div>
            </div>
          </template>
          <span v-if="app.room.pending || app.media.status !== 'playing'" class="stage-audio-status" role="status">{{ app.room.pending?'正在准备同步…':app.media.detail||'等待音乐开始' }}</span>
        </section>
        <!-- 相似推荐已按需求隐藏 -->
        <!-- <SimilarRecommendations :key="app.room.id" /> -->
      </div>
      <RoomChat :key="app.room.id" />
    </div>
  </section>
  <div v-else class="empty-state">
    <h3 class="loading-state" role="status">正在加入房间…</h3>
    <button class="secondary" @click="router.push('/')">返回房间列表</button>
  </div>
</template>

<style scoped>
.in-room-stage-page {
  padding-top: 4px;
  height: 100%;
  box-sizing: border-box;
}

.listening-stage {
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 10px 30px rgba(56, 82, 117, 0.05);
  transition: all 0.3s ease;
}

:deep(.room-chat) {
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 10px 30px rgba(56, 82, 117, 0.05);
}

.stage-ipod-wrap,
.stage-turntable-wrap {
  position: absolute;
  left: 20px;
  top: 16px;
  bottom: 16px;
  width: 60%;
  max-width: 720px;
  height: calc(100% - 32px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.listening-stage.ipod-active,
.listening-stage.turntable-active {
  min-height: 580px;
  height: 100%;
}

.listening-stage.ipod-active .stage-song,
.listening-stage.turntable-active .stage-song {
  position: absolute;
  left: auto;
  right: 5%;
  width: 33%;
  max-width: 360px;
  min-width: 260px;
  top: 50%;
  transform: translateY(-50%);
}

.listening-stage.ipod-active :deep(.stage-lyrics .lyric-scroll),
.listening-stage.turntable-active :deep(.stage-lyrics .lyric-scroll) {
  height: 390px;
  max-width: 340px;
}

/* 流光纯歌词播放器模式 */
.listening-stage.lumiere-active {
  min-height: 580px;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.52);
}

.stage-lumiere-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  z-index: 1;
}

.lumiere-ambient-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}

.ambient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.45;
  will-change: transform;
}

.orb-primary {
  width: 380px;
  height: 380px;
  top: -100px;
  left: 20%;
  background: radial-gradient(circle, rgba(var(--lumiere-primary-rgb), 0.4) 0%, rgba(var(--lumiere-secondary-rgb), 0.2) 50%, transparent 70%);
  animation: orb-float 10s ease-in-out infinite alternate;
}

.orb-secondary {
  width: 420px;
  height: 420px;
  bottom: -120px;
  right: 15%;
  background: radial-gradient(circle, rgba(var(--lumiere-secondary-rgb), 0.3) 0%, rgba(var(--lumiere-primary-rgb), 0.15) 50%, transparent 70%);
  animation: orb-float-alt 12s ease-in-out infinite alternate;
}

@keyframes orb-float {
  0% { transform: translate(0, 0) scale(1); }
  100% { transform: translate(40px, 30px) scale(1.15); }
}

@keyframes orb-float-alt {
  0% { transform: translate(0, 0) scale(1); }
  100% { transform: translate(-30px, -20px) scale(1.1); }
}

.lumiere-song-header {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 28px 12px;
  margin-right: 220px; /* 避开右上角房主控制胶囊 */
}

.lumiere-song-cover {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 4px 16px rgba(var(--lumiere-primary-rgb), 0.12);
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.9);
}

.lumiere-cover-art {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.lumiere-cover-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
}

.lumiere-song-meta {
  min-width: 0;
  flex: 1;
}

.lumiere-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.lumiere-title {
  font-size: 19px;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lumiere-artist {
  font-size: 12px;
  color: var(--lumiere-base, #64748b);
  margin: 3px 0 0;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lumiere-lyrics-container {
  position: relative;
  z-index: 2;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.lumiere-stage-lyrics {
  flex: 1;
  min-height: 0;
}

.lumiere-empty-lyric {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  font-size: 18px !important;
  color: var(--lumiere-primary, #1d6fee) !important;
  line-height: 1.8 !important;
  padding: 0 !important;
}

.lumiere-empty-lyric .text-button {
  display: block;
  margin: 12px auto 0;
  color: var(--lumiere-primary, #1d6fee);
  background: rgba(255, 255, 255, 0.9);
  padding: 8px 18px;
  border-radius: 20px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
}

.stage-top-presence {
  position: absolute;
  top: 20px;
  right: 24px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.stage-controller-badge {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  height: 38px;
  padding: 0 8px 0 14px;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.95);
  border-radius: 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.02);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.stage-controller-badge:hover {
  background: #ffffff;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.09);
  transform: translateY(-1px);
}

.stage-controller-badge:active {
  transform: translateY(0);
}

.controller-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.crown-icon {
  color: #f59e0b;
  fill: #fef3c7;
  flex-shrink: 0;
  filter: drop-shadow(0 1px 2px rgba(245, 158, 11, 0.35));
}

.controller-name {
  font-weight: 600;
  color: #1e293b;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.controller-tag {
  font-size: 10px;
  font-weight: 500;
  color: #b45309;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border: 1px solid rgba(245, 158, 11, 0.3);
  padding: 2px 7px;
  border-radius: 10px;
  white-space: nowrap;
  letter-spacing: 0.2px;
}

.stage-avatars {
  display: flex;
  align-items: center;
  gap: 0;
  margin: 0;
  padding: 0;
  background: none;
}

.stage-avatars .portrait {
  position: relative;
  width: 28px;
  height: 28px;
  font-size: 11px;
  margin-left: -5px;
  border: 2px solid #ffffff;
  box-sizing: border-box;
  transition: transform 0.15s ease;
}

.stage-avatars .portrait:first-child {
  margin-left: 0;
}

.stage-avatars .portrait.is-host {
  z-index: 2;
  border: 2px solid #f59e0b;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.35), 0 2px 6px rgba(245, 158, 11, 0.3);
  font-weight: 600;
}

.host-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 14px;
  height: 14px;
  background: linear-gradient(135deg, #fbbf24, #d97706);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}

.stage-avatars small {
  padding-left: 8px;
  color: #64748b;
  font-size: 11px;
  font-weight: 500;
}
</style>
