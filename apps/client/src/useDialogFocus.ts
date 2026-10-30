import { nextTick, onMounted, onUnmounted, type Ref } from 'vue';
let depth = 0, background: HTMLElement | null = null, originalInert = false, originalOverflow = '';
let originalPaddingRight = '', originalGap = '', originalGapPriority = '';
const scrollbarGapProperty = '--modal-scrollbar-gap';
/** Shared ownership keeps drawer-to-search handoffs locked without adding padding twice. */
export function lockModalBackground() {
 if (depth++ === 0) {
  const body = document.body, root = document.documentElement;
  background = document.querySelector('.shell'); originalInert = background?.inert ?? false;
  originalOverflow = body.style.overflow; originalPaddingRight = body.style.paddingRight;
  originalGap = root.style.getPropertyValue(scrollbarGapProperty);
  originalGapPriority = root.style.getPropertyPriority(scrollbarGapProperty);
  const padding = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
  const widthBefore = root.clientWidth;
  body.style.overflow = 'hidden';
  // Measure actual released space: overlay scrollbars or a stable gutter need no extra padding.
  const gap = Math.max(0, root.clientWidth - widthBefore);
  if (gap > 0) body.style.paddingRight = `${padding + gap}px`;
  root.style.setProperty(scrollbarGapProperty, `${gap}px`);
 }
 if (background) background.inert = true;
 let released = false;
 return () => {
  if (released) return; released = true;
  if (--depth === 0) {
   if (background) background.inert = originalInert;
   document.body.style.overflow = originalOverflow;
   document.body.style.paddingRight = originalPaddingRight;
   const style = document.documentElement.style;
   if (originalGap) style.setProperty(scrollbarGapProperty, originalGap, originalGapPriority);
   else style.removeProperty(scrollbarGapProperty);
   background = null;
  }
 };
}
/** Native dialog keyboard behaviour for our custom design surfaces. */
export function useDialogFocus(element: Ref<HTMLElement | null>, close: () => void) {
 let previous: HTMLElement | null = null, unlock = () => {};
 function key(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === 'Escape') { event.preventDefault(); close(); }
  if (event.key !== 'Tab') return;
  const nodes = [...(element.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"],summary') ?? [])].filter(n => n.getClientRects().length);
  if (!nodes.length) { event.preventDefault(); return; }
  if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
  else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
 }
 onMounted(async () => {
  previous = document.activeElement as HTMLElement; unlock = lockModalBackground();
  document.addEventListener('keydown', key); await nextTick();
  (element.value?.querySelector<HTMLElement>('[autofocus]') ?? element.value?.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled)'))?.focus();
 });
 onUnmounted(() => { document.removeEventListener('keydown', key); unlock(); previous?.focus(); });
}
