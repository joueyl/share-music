import { watch, type Ref } from 'vue';

export function useAutoDismissNotice(notice: Ref<string>) {
  return watch(notice, (value, _, onCleanup) => {
    if (!value) return;
    const timer = setTimeout(() => { notice.value = ''; }, 2000);
    onCleanup(() => clearTimeout(timer));
  }, { immediate: true, flush: 'sync' });
}
