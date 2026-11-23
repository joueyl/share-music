import { computed,onMounted,ref,watch } from 'vue';
import { useRoute,useRouter } from 'vue-router';
import { useApp } from '../store';
import * as bridge from '../bridge';
export async function copyRoomInvite(code: string | undefined, notify: (message: string) => void) {
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    notify('房间码已复制，请私下分享给朋友');
  } catch {
    notify(`房间码：${code}，请手动复制并私下分享`);
  }
}
/** Shared domain controller: desktop and APK must use the same request/permission flow. */
export function useRoomSession(){
const app = useApp();
const route = useRoute();
const router = useRouter();
const leaving = ref(false);
const resolvedCover = ref('');
const floatingChat=ref(false);

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
  [() => app.room?.id, () => track.value?.id, () => track.value?.contentHash],
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

const invite = () => copyRoomInvite(app.room?.inviteCode, message => { app.notice = message; });

return { app,route,router,leaving,track,coverUrl,online,hostMember,sortedOnline,floatingChat,exit,invite };
}
