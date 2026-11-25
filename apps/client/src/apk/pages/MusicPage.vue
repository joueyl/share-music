<script setup lang="ts">
import { Heart, Link, Plus, Play, ArrowLeft, Music2, LoaderCircle } from 'lucide-vue-next';
import { useMusicLibrary } from '../../features/useMusicLibrary';
import AlbumArt from '../../components/AlbumArt.vue';
import SongFavoriteButton from '../../components/SongFavoriteButton.vue';
import FavoriteSongsList from '../../components/FavoriteSongsList.vue';
const {app,link,tab,opened,favoriteTab,songs,selected,busy,loading,message,showImport,detailTarget,detailFailed,profile,profileError,bindingBusy,profileId,favoritesReady,favoritesLoading,favoriteBusy,collectionList,available,addHint,allSelected,cards,toggle,toggleAll,switchTab,readFavorites,restoreProfile,unbindProfile,isSaved,favorite,openCollection,load,back,add}=useMusicLibrary();
</script>
<template>
 <section class="apk-music" :aria-busy="busy||loading||favoritesLoading">
  <h1>我的音乐</h1>
  <template v-if="!detailTarget">
   <div v-if="profile&&tab==='netease'" class="apk-card apk-profile"><AlbumArt :src="profile.avatarUrl" :alt="profile.nickname+'的头像'" /><div><h2>{{ profile.nickname }}</h2><p>{{ profile.signature||'网易云主页已绑定' }}</p></div><div class="apk-profile-actions"><button class="secondary" :disabled="loading||busy||bindingBusy" @click="restoreProfile">刷新</button><button class="secondary" :disabled="busy||bindingBusy" :aria-expanded="showImport" @click="showImport=!showImport">{{ showImport?'收起输入':'更换 / 打开链接' }}</button><button class="text-button" :disabled="busy||bindingBusy" @click="unbindProfile">解除绑定</button></div></div>
   <div class="apk-segments" role="tablist" aria-label="APK 音乐分类"><button role="tab" :aria-selected="tab==='netease'" :disabled="busy||bindingBusy" @click="switchTab('netease')">音乐主页</button><button role="tab" :aria-selected="tab==='favorites'" :disabled="busy||bindingBusy" @click="switchTab('favorites')">已收藏</button></div>
  </template>
  <form v-if="tab==='netease'&&(!profile||showImport)&&!detailTarget" class="apk-card apk-bind" @submit.prevent="load"><label for="apk-music-link"><Link :size="20" />主页 / 歌单链接</label><input id="apk-music-link" v-model="link" maxlength="4096" placeholder="粘贴网易云主页、歌单或专辑链接" :disabled="busy||bindingBusy" /><button class="primary full" :disabled="loading||busy||bindingBusy||!link.trim()">{{ loading?'正在读取…':'绑定 / 打开' }}</button><p class="apk-hint">QQ 任意个人主页暂不支持，绑定不代表音源登录。</p></form>
  <p v-if="message" class="apk-message" role="status">{{ message }}</p>
  <template v-if="detailTarget">
   <button class="text-button" :disabled="busy" @click="back"><ArrowLeft :size="18" />返回歌单列表</button>
   <header v-if="opened" class="apk-card apk-collection-summary"><AlbumArt :src="opened.coverUrl" /><div><h2>{{ opened.name }}</h2><p>网易云{{ opened.kind==='album'?'专辑':'歌单' }} · {{ opened.trackCount }} 首</p><button class="text-button" :disabled="!!favoriteBusy||!favoritesReady" :aria-pressed="isSaved(opened)" @click="favorite(opened)"><Heart :size="18" />{{ isSaved(opened)?'已收藏':'收藏' }}</button></div></header>
   <div class="apk-library-toolbar">
    <div class="apk-selection"><label><input type="checkbox" :checked="allSelected" :indeterminate="selected.size>0&&!allSelected" :disabled="busy||loading||!songs.length" @change="toggleAll" />全选歌曲</label><small>已选 {{ selected.size }} 首</small></div>
    <div class="apk-library-actions"><button class="primary" :disabled="!available||!selected.size" :aria-busy="busy" @click="add(false)"><Plus :size="18" />{{ busy?'处理中…':`加入房间 · ${selected.size} 首` }}</button><button class="secondary" :disabled="!available||!selected.size||!app.permission.skip" @click="add(true)"><Play :size="17" />立即播放</button></div>
   </div>
   <p class="apk-hint">{{ addHint }}</p>
   <div v-if="loading" class="apk-card apk-state" role="status"><LoaderCircle :size="32" class="spinning" />正在读取完整歌单…</div>
   <div v-else-if="detailFailed" class="apk-card apk-state"><h2>歌单暂时无法读取</h2><button class="primary" @click="openCollection(detailTarget!)">重新读取</button></div>
   <div v-else class="apk-song-list" tabindex="0" aria-label="APK 歌单歌曲列表"><label v-for="song in songs" :key="song.id" class="apk-card apk-song-row" :data-selected="selected.has(song.id)"><input type="checkbox" :checked="selected.has(song.id)" :disabled="busy" @change="toggle(song.id)" /><span><strong>{{ song.name }}</strong><small>{{ song.artists }} · {{ song.album }}</small></span><SongFavoriteButton source="netease" :song-id="song.id" :name="song.name" /></label><p v-if="!songs.length" class="apk-card apk-state">暂无可访问歌曲</p></div>
   <small class="apk-hint">已读取 {{ songs.length }} / {{ opened?.trackCount??0 }} 首 · 加入不会打断播放</small>
  </template>
  <template v-else>
   <div v-if="tab==='favorites'" class="apk-subtabs" role="tablist" aria-label="收藏类型"><button role="tab" :aria-selected="favoriteTab==='collections'" @click="favoriteTab='collections'">歌单 / 专辑</button><button role="tab" :aria-selected="favoriteTab==='songs'" @click="favoriteTab='songs'">单曲</button></div>
   <FavoriteSongsList v-if="tab==='favorites'&&favoriteTab==='songs'" />
   <div v-else-if="loading||favoritesLoading" class="apk-card apk-state" role="status"><LoaderCircle :size="32" class="spinning" />正在读取音乐…</div>
   <div v-else-if="cards.length" ref="collectionList" class="apk-collections" tabindex="0" aria-label="APK 歌单列表"><article v-for="item in cards" :key="item.kind+':'+item.id"><button class="apk-collection-open" :data-collection-key="item.kind+':'+item.id" :disabled="busy" :aria-label="`打开歌单 ${item.name}`" @click="openCollection(item)"><AlbumArt :src="item.coverUrl" /><strong>{{ item.name }}</strong><small>{{ item.trackCount }} 首</small></button><button class="icon-button" :disabled="!!favoriteBusy||!favoritesReady" :aria-label="(isSaved(item)?'取消收藏 ':'收藏 ')+item.name" :aria-pressed="isSaved(item)" @click="favorite(item)"><Heart :size="20" /></button></article></div>
   <div v-else class="apk-card apk-state" role="status"><Music2 :size="36" /><h2>{{ tab==='favorites'?(favoritesReady?'还没有收藏':'收藏暂时无法读取'):profileError?'音乐主页暂时无法读取':profileId?'暂无可访问歌单':'绑定主页，找回你的音乐' }}</h2><p>{{ tab==='favorites'?'在歌单或歌曲旁点爱心，将音乐留在这里。':'粘贴网易云链接，读取真实主页与可访问歌单。' }}</p><button v-if="profileError" class="primary" @click="restoreProfile">重新读取主页</button><button v-if="tab==='favorites'&&!favoritesReady" class="primary" @click="readFavorites">重新读取收藏</button></div>
  </template>
 </section>
</template>

<style scoped>
.apk-library-toolbar{
 display:flex;flex-direction:column;gap:6px;padding:8px 12px;
 background:#f4f7fc;border:1px solid white;border-radius:16px;
}
@media(min-height:480px){
 .apk-library-toolbar{position:sticky;top:0;z-index:2}
 .apk-song-list,.apk-song-list :is(input,button){scroll-margin-top:112px}
}
</style>
