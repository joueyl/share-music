import { ref, type InjectionKey } from 'vue';

export function createApkRoomLayout() {
  return { lyrics: ref(false), chat: ref(false), threeD: ref(false) };
}

export const apkRoomLayoutKey: InjectionKey<ReturnType<typeof createApkRoomLayout>> = Symbol('apk-room-layout');
