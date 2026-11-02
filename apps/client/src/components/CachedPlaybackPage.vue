<script setup lang="ts">
import { provide, type Component, type VNode } from 'vue';
import { CACHED_PAGE_ACTIVE, useCachedActivity } from '../useCachedActivity';
defineOptions({name:'CachedPlaybackPage'});
defineProps<{view:Component|VNode}>();
provide(CACHED_PAGE_ACTIVE,useCachedActivity());
</script>
<template><div class="route-page in-room-page"><component :is="view" /></div></template>
