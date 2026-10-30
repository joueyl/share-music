<script setup lang="ts">
import { ref, watch } from 'vue';
import placeholder from '../assets/album-placeholder.svg';
const props = defineProps<{src?:string|null;alt?:string}>();
const failed = ref(false); watch(() => props.src, () => { failed.value = false; });
</script>
<template><img class="album-art" :src="!failed && src ? src : placeholder" :alt="alt ?? '专辑封面'" loading="lazy" referrerpolicy="no-referrer" @error="failed=true" /></template>
