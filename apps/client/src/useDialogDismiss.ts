import { ref } from 'vue';

/** Keep the owning dialog (and its focus lock) mounted while its surface leaves. */
export function useDialogDismiss(onDismiss: () => void, animated: () => boolean) {
  const dialogVisible = ref(true);
  let finished = false;

  function finishDismiss() {
    if (dialogVisible.value || finished) return;
    finished = true;
    onDismiss();
  }

  function dismiss() {
    if (!dialogVisible.value) return;
    dialogVisible.value = false;
    if (!animated() || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) finishDismiss();
  }

  return { dialogVisible, dismiss, finishDismiss };
}
