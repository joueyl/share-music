<script setup lang="ts">
import { Plus, Users, Headphones, RefreshCw, Link, X, Search } from 'lucide-vue-next';
import { ui } from '../ui';
import RoomSettingsDialog from '../components/RoomSettingsDialog.vue';
import discoveryRecord from '../assets/discovery-record.png';
import { useRoomDiscovery } from '../features/useRoomDiscovery';
const { app,router,rooms,creating,codeOpen,code,keywords,category,loading,joining,resolving,moods,loadError,load,enter,resolve,created } = useRoomDiscovery();
</script>
<template>
 <RoomSettingsDialog v-if="creating" create @close="creating=false" @created="created" />
 <section class="page discovery-page">
  <section class="discovery-hero"><div class="discovery-copy"><span>MUSIC SOUNDS BETTER TOGETHER</span><h1>此刻，和谁一起听？</h1><p>把喜欢的歌分享给喜欢的人。距离再远，也能听见同一秒。</p><div><button class="primary" :disabled="!app.connected" @click="creating=true"><Plus :size="18" />创建我的房间</button><button class="secondary" :disabled="!app.connected" @click="codeOpen=!codeOpen"><Link :size="18" />输入房间码加入</button></div></div><img :src="discoveryRecord" alt="唱片与同频朋友的插画" width="480" height="240" /></section>
  <form v-if="codeOpen" class="invite-code-form" @submit.prevent="resolve"><Link :size="18" /><label class="sr-only" for="room-code">房间码</label><input id="room-code" v-model="code" placeholder="输入 12 位房间码" pattern="[a-fA-F0-9]{12}" maxlength="12" required /><button class="primary" :disabled="resolving||!app.connected">{{ resolving?'加入中…':'加入房间' }}</button><button type="button" class="icon-button" aria-label="关闭房间码输入" @click="codeOpen=false"><X :size="18" /></button></form>
  <form class="mobile-room-search" @submit.prevent="load"><Search :size="20" /><input v-model="keywords" aria-label="搜索房间" placeholder="搜索房间" maxlength="100" /><button type="submit" class="icon-button" aria-label="查找房间" :disabled="loading"><Search :size="18" /></button></form>
  <div class="discovery-filterbar"><h2>正在发生的好音乐</h2><div class="category-tabs"><button v-for="item in [{name:'为你推荐',value:''},{name:'华语',value:'华语'},{name:'独立 / 民谣',value:'民谣'},{name:'轻音乐',value:'轻音乐'},{name:'深夜陪伴',value:'深夜'}]" :key="item.name" :class="{selected:category===item.value}" :aria-pressed="category===item.value" :title="item.value?undefined:'按可见房间展示，当前服务端没有个性化推荐接口'" @click="category=item.value;load()">{{ item.name }}</button></div><button class="friends-filter" title="当前服务端没有好友关系接口" @click="app.notice='当前服务端暂无好友关系与好友筛选接口'"><Users :size="15" />只看好友</button><button class="icon-button" aria-label="刷新房间" :disabled="loading" @click="load"><RefreshCw :size="15" :class="{spinning:loading}" /></button></div>
  <form v-if="keywords" class="room-filter-summary desktop-room-search" @submit.prevent="load"><Search :size="16" /><input v-model="keywords" maxlength="100" aria-label="搜索房间" /><button class="text-button" @click.prevent="keywords='';ui.roomKeywords='';load()">清除搜索</button></form>
  <div v-if="loadError&&!rooms.length" class="empty-state discovery-status" role="status"><Headphones :size="32" /><h3>房间暂时无法读取</h3><p>请检查连接后重试，不会清除当前房间。</p><button class="primary" :disabled="loading" @click="load">重新读取</button></div>
  <div v-else-if="loading&&!rooms.length" class="empty-state loading-state discovery-status" role="status">正在发现同频的人…</div>
  <TransitionGroup v-else-if="rooms.length" tag="div" name="list" class="discovery-grid" tabindex="0" aria-label="房间列表">
   <button v-for="room in rooms" :key="room.id" type="button" class="discovery-card" :disabled="!!joining||!app.connected||room.members>=room.maxMembers" :aria-busy="joining===room.id" :aria-label="`${room.name}，${room.members} 人在线，${joining===room.id?'正在加入':room.members>=room.maxMembers?'房间已满':'点击加入房间'}`" @click="enter(room.id)">
    <span class="landscape-cover" :class="room.settings?.atmosphere??'sunset'" :style="room.settings?.coverUrl?{backgroundImage:`url(${JSON.stringify(room.settings.coverUrl)})`}:undefined"><template v-if="!room.settings?.coverUrl"><i class="landscape-sun" /><i class="landscape-hill hill-back" /><i class="landscape-hill hill-front" /><strong>{{ moods[room.settings?.atmosphere??'sunset'] }}</strong></template><span class="room-online"><Headphones :size="14" />{{ room.members }} 人在线</span></span>
    <span class="discovery-card-body"><span class="mobile-room-count">{{ room.settings?.category || '一起听' }} · {{ room.members }} / {{ room.maxMembers }} 人</span><strong class="discovery-card-title">{{ room.name }}</strong><span class="discovery-card-description">{{ room.settings?.description||'留一点时间，给耳机里的小世界。' }}</span><small v-if="joining===room.id||room.members>=room.maxMembers" class="room-card-status" role="status">{{ joining===room.id?'正在加入…':'房间已满' }}</small></span>
   </button>
  </TransitionGroup>
  <div v-else class="empty-state discovery-status"><Headphones :size="32" /><h3>第一段旋律，等你开启</h3><p>{{ keywords||category?'没有匹配的房间，试试其他关键词或分类。':'还没有公开房间，创建一个，邀请朋友一起听。' }}</p></div>
  <p class="discovery-footnote">音乐是入口，陪伴才是目的。<span>每房间最多 8 人 · {{ rooms.length }} 个可见房间</span></p>
 </section>
</template>

<style scoped>
.mobile-room-search,.mobile-room-count{display:none}
@media(max-width:720px),(max-width:900px) and (pointer:coarse){
 .mobile-room-search{display:flex;align-items:center;flex-shrink:0;gap:10px;background:#ffffffd9;border:1px solid white;border-radius:16px;min-height:48px;padding:0 6px 0 14px;margin-top:12px;color:var(--muted)}
 .mobile-room-search input{border:0;background:none;min-width:0;font-size:16px;padding:12px 0;flex:1}
 .discovery-card-title{font-size:17px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
 .discovery-card-description{font-size:12px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
 .desktop-room-search{display:none}
 .mobile-room-count{display:block;order:1;font-size:12px;color:var(--muted)}
}
</style>
