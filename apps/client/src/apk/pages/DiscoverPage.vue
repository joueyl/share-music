<script setup lang="ts">
import { Plus, Hash, Search, RefreshCw, Disc3, ChevronRight, X } from 'lucide-vue-next';
import { useRoomDiscovery } from '../../features/useRoomDiscovery';
import RoomSettingsDialog from '../../components/RoomSettingsDialog.vue';
const {app,rooms,creating,codeOpen,code,keywords,category,loading,joining,resolving,loadError,load,enter,resolve,created}=useRoomDiscovery();
</script>
<template>
 <RoomSettingsDialog v-if="creating" create @close="creating=false" @created="created" />
 <section class="apk-discover">
  <header class="apk-card apk-hero"><h1>找到你的同频。</h1><p>把今天的心情，放进同一首歌里。</p></header>
  <div class="apk-discover-actions"><button class="primary" :disabled="!app.connected" @click="creating=true"><Plus :size="22" />创建房间</button><button class="secondary" :disabled="!app.connected" :aria-expanded="codeOpen" @click="codeOpen=!codeOpen"><Hash :size="22" />房间码加入</button></div>
  <form v-if="codeOpen" class="apk-card apk-code-form" @submit.prevent="resolve"><label for="apk-room-code">12 位房间码</label><input id="apk-room-code" v-model="code" required maxlength="12" pattern="[a-fA-F0-9]{12}" placeholder="输入房间码" /><button class="primary" :disabled="resolving||!app.connected">{{ resolving?'加入中…':'加入' }}</button><button type="button" class="icon-button" aria-label="收起房间码" @click="codeOpen=false"><X :size="20" /></button></form>
  <form class="apk-input apk-room-search" @submit.prevent="load"><Search :size="22" /><input v-model="keywords" aria-label="搜索房间" maxlength="100" placeholder="搜索房间" /><button class="icon-button" aria-label="查找房间" :disabled="loading"><Search :size="20" /></button></form>
  <div class="apk-categories" aria-label="房间分类"><button v-for="item in [{label:'全部',id:''},{label:'轻松随听',id:'轻音乐'},{label:'深夜电台',id:'深夜'},{label:'民谣',id:'民谣'}]" :key="item.id" :aria-pressed="category===item.id" @click="category=item.id;load()">{{ item.label }}</button></div>
  <header class="apk-section-heading"><h2>正在发生的同频</h2><small>{{ rooms.length }} 个房间</small><button class="icon-button" aria-label="刷新房间" :disabled="loading" @click="load"><RefreshCw :size="18" :class="{spinning:loading}" /></button></header>
  <div v-if="loading&&!rooms.length" class="apk-card apk-state" role="status"><Disc3 :size="36" class="spinning" /><h2>正在发现同频的人…</h2></div>
  <div v-else-if="loadError&&!rooms.length" class="apk-card apk-state" role="status"><h2>房间暂时无法读取</h2><p>请检查连接后重试。</p><button class="primary" @click="load">重新读取</button></div>
  <div v-else-if="!rooms.length" class="apk-card apk-state" role="status"><Disc3 :size="36" /><h2>第一段旋律，等你开启</h2><p>没有匹配的公开房间，试试其他分类或创建房间。</p></div>
  <div v-else class="apk-room-list" tabindex="0" aria-label="APK 房间列表"><button v-for="room in rooms" :key="room.id" class="apk-card apk-room-card" :disabled="!!joining||!app.connected||room.members>=room.maxMembers" :aria-busy="joining===room.id" :aria-label="`${room.name}，${room.members}/${room.maxMembers} 人，加入房间`" @click="enter(room.id)"><span class="apk-room-art" :data-mood="room.settings?.atmosphere"><Disc3 :size="32" /></span><span class="apk-room-info"><strong :title="room.name">{{ room.name }}</strong><small>{{ room.settings?.category||'一起听' }} · {{ room.members }} / {{ room.maxMembers }} 人</small><small v-if="joining===room.id||room.members>=room.maxMembers">{{ joining===room.id?'正在加入…':'房间已满' }}</small></span><ChevronRight :size="22" /></button></div>
 </section>
</template>
