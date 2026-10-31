<script setup lang="ts">
import ThemeCustomizerPopover from './ThemeCustomizerPopover.vue';

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div class="theme-customizer-dialog-compat" @click.self="emit('close')">
    <ThemeCustomizerPopover @close="emit('close')" />
  </div>
</template>

<style scoped>
.theme-customizer-dialog-compat {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: transparent;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 56px 24px;
}
</style>
