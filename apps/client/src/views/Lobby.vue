<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, ArrowUpRight, Users, Radio, RefreshCw } from 'lucide-vue-next';
import { useApp } from '../store';
import * as bridge from '../bridge';
const app = useApp(), router = useRouter();
const rooms = ref<Awaited<ReturnType<typeof bridge.listRooms>>>([]), name = ref(''), creating = ref(false), loading = ref(false);
let timer: ReturnType<typeof setInterval>;
async function load() { loading.value = true; try { rooms.value = await bridge.listRooms(); } catch (e) { app.error(e); } finally { loading.value = false; } }
async function enter(id: string) { try { await bridge.join(id); await router.push(`/room/${id}`); } catch (e) { app.error(e); } }
async function create() { try { const room = await bridge.createRoom(name.value); creating.value = false; name.value = ''; await load(); await enter(room.id); } catch (e) { app.error(e); } }
onMounted(() => { void load(); timer = setInterval(load, 10000); }); onUnmounted(() => clearInterval(timer));
</script>
<template>
  <header class="topbar"><span>发现 / 音乐房间</span><span class="topbar-right"><span class="dot online" /> P2P 音乐空间</span></header>
  <section class="page">
    <div class="page-heading"><div><span class="eyebrow">A SPACE FOR EVERY SOUND</span><h1>一起听，好过一个人。</h1><p class="muted">找一个房间，把此刻的音乐分享出去。</p></div><button class="primary" :disabled="!app.connected" @click="creating = true"><Plus :size="18" />创建房间</button></div>
    <div class="hero"><div><div class="hero-label"><Radio :size="16" /> 共鸣 · LISTENING ROOMS</div><h2>隔着距离，<br>共享同一段旋律。</h2><p>本地音乐 · 实时音源 · 无损优先</p></div><div class="record-art"><div class="vinyl"><div class="vinyl-label"><Radio :size="32" /><small>共 鸣</small></div></div><div class="art-orbit orbit-one" /><div class="art-orbit orbit-two" /><span class="art-caption">SAME SONG. SAME MOMENT.</span></div></div>
    <div class="section-title"><h2>所有房间 <span>{{ rooms.length.toString().padStart(2, '0') }}</span></h2><button class="text-button" @click="load"><RefreshCw :size="14" :class="{ spinning: loading }" />刷新</button></div>
    <div v-if="rooms.length" class="room-grid"><button v-for="(room, i) in rooms" :key="room.id" class="room-card" :disabled="!app.connected || room.members >= room.maxMembers" @click="enter(room.id)"><div class="room-art" :class="`art-${i % 3}`"><Radio :size="38" /><span class="badge">{{ room.qualityMode === 'opus' ? '有损模式' : '无损优先' }}</span></div><div class="room-card-body"><h3>{{ room.name }}<ArrowUpRight :size="19" /></h3><div class="muted room-meta"><span><Users :size="14" />{{ room.members }} / {{ room.maxMembers }} 人</span><span>{{ room.members >= room.maxMembers ? '房间已满' : '点击加入' }}</span></div></div></button></div>
    <div v-else class="empty-state"><Radio :size="32" /><h3>第一段旋律，等你开启</h3><p>还没有房间。创建一个，邀请朋友一起听。</p></div>
    <div class="capacity-note">每房间最多 8 人。无损播放容量根据音源上行和连接质量动态确定。</div>
  </section>
  <div v-if="creating" class="modal-backdrop" @click.self="creating = false"><form class="modal" @submit.prevent="create"><h2>创建音乐房间</h2><label>房间名称<input v-model="name" autofocus required maxlength="80" placeholder="例如：今晚的爵士电台" /></label><p class="muted">默认仅房主控制播放，成员可以添加音乐。</p><div class="modal-actions"><button type="button" class="secondary" @click="creating = false">取消</button><button class="primary">创建房间</button></div></form></div>
</template>
