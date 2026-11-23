<script setup lang="ts">
import { Plus, Hash, Search, RefreshCw, Disc3, ChevronRight, X } from 'lucide-vue-next';
import { useRoomDiscovery } from '../../features/useRoomDiscovery';
import AlbumArt from '../../components/AlbumArt.vue';
import RoomSettingsDialog from '../../components/RoomSettingsDialog.vue';
const {app,rooms,creating,codeOpen,code,keywords,category,loading,joining,resolving,loadError,load,enter,resolve,created}=useRoomDiscovery();
</script>
<template>
 <RoomSettingsDialog v-if="creating" create @close="creating=false" @created="created" />
 <section class="apk-discover" aria-label="发现房间">
  <div class="apk-discover-actions"><button class="primary" :disabled="!app.connected" @click="creating=true"><Plus :size="22" />创建房间</button><button class="secondary" :disabled="!app.connected" :aria-expanded="codeOpen" @click="codeOpen=!codeOpen"><Hash :size="22" />房间码加入</button></div>
  <form v-if="codeOpen" class="apk-card apk-code-form" @submit.prevent="resolve"><label for="apk-room-code">12 位房间码</label><input id="apk-room-code" v-model="code" required maxlength="12" pattern="[a-fA-F0-9]{12}" placeholder="输入房间码" /><button class="primary" :disabled="resolving||!app.connected">{{ resolving?'加入中…':'加入' }}</button><button type="button" class="icon-button" aria-label="收起房间码" @click="codeOpen=false"><X :size="20" /></button></form>
  <form class="apk-input apk-room-search" role="search" @submit.prevent="load"><button type="submit" class="icon-button" aria-label="查找房间" :disabled="loading"><Search :size="20" /></button><input v-model="keywords" aria-label="搜索房间" maxlength="100" placeholder="搜索房间" /></form>
  <div class="apk-discover-results">
  <div class="apk-categories" role="group" aria-label="房间分类"><button v-for="item in [{label:'全部',id:''},{label:'轻松随听',id:'轻音乐'},{label:'深夜电台',id:'深夜'},{label:'民谣',id:'民谣'}]" :key="item.id" :aria-pressed="category===item.id" @click="category=item.id;load()">{{ item.label }}</button></div>
  <header class="apk-section-heading"><h1>正在发生的同频</h1><small>{{ rooms.length }} 个房间</small><button class="icon-button" aria-label="刷新房间" :disabled="loading" @click="load"><RefreshCw :size="16" :class="{spinning:loading}" /></button></header>
  <div v-if="loading&&!rooms.length" class="apk-card apk-state" role="status"><Disc3 :size="36" class="spinning" /><h2>正在发现同频的人…</h2></div>
  <div v-else-if="loadError&&!rooms.length" class="apk-card apk-state" role="status"><h2>房间暂时无法读取</h2><p>请检查连接后重试。</p><button class="primary" @click="load">重新读取</button></div>
  <div v-else-if="!rooms.length" class="apk-card apk-state" role="status"><Disc3 :size="36" /><h2>第一段旋律，等你开启</h2><p>没有匹配的公开房间，试试其他分类或创建房间。</p></div>
  <div v-else class="apk-room-list" tabindex="0" aria-label="APK 房间列表">
   <button v-for="room in rooms" :key="room.id" type="button" class="apk-card apk-room-card" :disabled="!!joining||!app.connected||room.members>=room.maxMembers" :aria-busy="joining===room.id" :aria-label="`${room.name}，${room.members}/${room.maxMembers} 人，${joining===room.id?'正在加入':room.members>=room.maxMembers?'房间已满':'加入房间'}`" @click="enter(room.id)">
    <span class="apk-room-art" :data-mood="room.settings?.atmosphere" aria-hidden="true"><AlbumArt v-if="room.settings?.coverUrl" :src="room.settings.coverUrl" alt="" /><Disc3 v-else :size="24" /></span>
    <span class="apk-room-info">
     <strong :title="room.name">{{ room.name }}</strong>
     <small v-if="room.settings?.description" class="apk-room-description">{{ room.settings.description }}</small>
     <small>{{ room.settings?.category||'一起听' }} · {{ room.members }} / {{ room.maxMembers }} 人<span v-if="joining===room.id||room.members>=room.maxMembers"> · {{ joining===room.id?'正在加入…':'房间已满' }}</span></small>
    </span>
    <ChevronRight :size="18" class="apk-room-chevron" aria-hidden="true" />
   </button>
  </div>
  </div>
 </section>
</template>

<style scoped>
.apk-discover{--discover-gap:16px;--room-list-gap:12px;--room-card-min:94px;--room-art-size:56px;flex:1;min-height:0;display:flex;flex-direction:column;gap:var(--discover-gap)}
.apk-discover>*,.apk-discover-results>*{flex-shrink:0}
.apk-discover-results{display:flex;flex:1;flex-direction:column;min-height:0;gap:6px}
.apk-discover-actions{display:flex;gap:12px}
.apk-discover-actions button{flex:1;min-width:0;min-height:48px;padding:8px 10px;border-radius:14px;font-size:14px}
.apk-code-form{display:flex;flex-wrap:wrap;gap:8px}.apk-code-form label{width:100%}.apk-code-form input{flex:1;min-width:100px}
.apk-room-search{gap:2px;min-height:48px;padding:0 12px 0 4px;border-radius:16px}
.apk-room-search input{padding:8px 0}
.apk-categories{display:flex;gap:8px;overflow-x:auto}
.apk-categories button{flex-shrink:0;min-height:44px;padding:8px 14px;background:#ffffffb3;color:#53667e;border-radius:16px;font-size:14px}
.apk-categories [aria-pressed=true]{background:var(--accent);color:white}
.apk-section-heading{display:flex;align-items:center;gap:4px}
.apk-section-heading h1{font-size:17px;line-height:1.5;flex:1;min-width:0}
.apk-section-heading small{white-space:nowrap}
.apk-discover-results>.apk-state,.apk-room-list{flex:1 1 0;min-height:var(--room-card-min);overflow:auto;overscroll-behavior:contain}
.apk-room-list{display:flex;flex-direction:column;gap:var(--room-list-gap);padding:2px;scrollbar-gutter:stable}
.apk-room-card{display:flex;align-items:center;gap:12px;flex-shrink:0;width:100%;min-height:var(--room-card-min);text-align:left;padding:12px 14px;border-radius:20px}
.apk-room-info{flex:1;min-width:0;display:grid;gap:3px}
.apk-room-info strong,.apk-room-description{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.apk-room-info strong{font-size:16px;line-height:1.4;-webkit-line-clamp:2}
.apk-room-description{-webkit-line-clamp:1}
.apk-room-info small{line-height:1.45;overflow-wrap:anywhere}
.apk-room-art{width:var(--room-art-size);height:var(--room-art-size);flex:0 0 var(--room-art-size);display:grid;place-items:center;border-radius:14px;color:white;background:linear-gradient(135deg,#cfdfd2,#85a29a)}
.apk-room-art[data-mood=night]{background:linear-gradient(135deg,#d2e1f3,#869fbe)}
.apk-room-art[data-mood=weekend]{background:linear-gradient(135deg,#f2dfc9,#bc9c82)}
.apk-room-art .album-art{width:100%;height:100%;border-radius:inherit;object-fit:cover}
.apk-room-chevron{color:#65748b}
@media(max-width:359px),(max-height:560px){
 .apk-discover{--discover-gap:10px;--room-list-gap:8px;--room-card-min:76px;--room-art-size:44px}
 .apk-discover-actions{gap:8px}
 .apk-categories button{padding-inline:10px}
 .apk-room-card{padding:8px 10px;gap:8px}
}
@media(min-width:600px){.apk-room-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start}}
@media(orientation:landscape) and (min-width:600px) and (max-height:560px){
 .apk-discover:not(:has(.apk-code-form)){display:grid;gap:8px;grid-template:"actions heading" auto "search rooms" auto "categories rooms" minmax(44px,1fr) / minmax(0,1fr) minmax(0,1.45fr)}
 .apk-discover:not(:has(.apk-code-form)) .apk-discover-results{display:contents}
 .apk-discover-actions{grid-area:actions}
 .apk-room-search{grid-area:search}
 .apk-categories{grid-area:categories;align-self:start}
 .apk-section-heading{grid-area:heading}
 .apk-discover-results>.apk-state,.apk-room-list{grid-area:rooms;min-height:0}
 .apk-room-list{grid-template-columns:minmax(0,1fr)}
}
</style>
