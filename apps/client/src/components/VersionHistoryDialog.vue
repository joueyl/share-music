<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { History, X, RefreshCw, Download, LoaderCircle } from 'lucide-vue-next';
import { APP_VERSION, RELEASE_HISTORY } from '../version-info';
import { appUpdates } from '../app-updates';
const updates=appUpdates.state,updateBusy=appUpdates.busy,updateLocked=appUpdates.locked,updatePercent=appUpdates.percent,confirmed=ref(false);
const emit=defineEmits<{close:[]}>(),visible=ref(true),dialog=ref<HTMLElement|null>(null),closeButton=ref<HTMLButtonElement|null>(null);
let previous:HTMLElement|null=null,background:HTMLElement|null=null,wasInert=false,overflow='',alive=true;
function close(){if(!updateLocked.value)visible.value=false;}
function trap(event:KeyboardEvent){
 if(event.isComposing)return;
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
 if(event.key!=='Tab')return;
 const all=dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]');if(!all?.length)return;
 const first=all[0],last=all[all.length-1];
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
 else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
}
onMounted(async()=>{
 previous=document.activeElement as HTMLElement;background=document.querySelector<HTMLElement>('.shell');
 if(background){wasInert=background.inert;background.inert=true;}
 overflow=document.body.style.overflow;document.body.style.overflow='hidden';document.addEventListener('keydown',trap);
 await nextTick();if(alive)closeButton.value?.focus();
});
onUnmounted(()=>{alive=false;document.removeEventListener('keydown',trap);if(background)background.inert=wasInert;document.body.style.overflow=overflow;previous?.focus();});
</script>
<template>
 <Teleport to="body"><Transition name="modal" appear @after-leave="emit('close')"><div v-if="visible" class="modal-backdrop" @click.self="close">
  <section ref="dialog" class="modal version-history-modal" role="dialog" aria-modal="true" aria-labelledby="version-history-title">
   <header class="music-search-header"><div><span class="eyebrow">MUSIC SHARE · VERSION HISTORY</span><h2 id="version-history-title"><History :size="22" />版本与更新日志</h2></div><button ref="closeButton" class="icon-button" aria-label="关闭更新日志" :disabled="updateLocked" @click="close"><X :size="20" /></button></header>
   <div class="version-summary"><span>当前版本</span><strong>v{{ APP_VERSION }}</strong><small>内置更新记录 · “未发布”内容尚未归档为新版本</small></div>
   <section class="app-update-panel" aria-label="桌面客户端更新" :aria-busy="updateBusy">
    <div class="update-toolbar"><span>GitHub · joueyl/share-music</span><button class="secondary" :disabled="updateBusy" :aria-busy="updates.phase==='checking'" @click="confirmed=false;appUpdates.check()"><LoaderCircle v-if="updates.phase==='checking'" class="spinning" :size="15" /><RefreshCw v-else :size="15" />检查更新</button></div>
    <p v-if="updates.message" class="update-status" role="status">{{ updates.message }}</p>
    <template v-if="updates.phase==='available'"><pre v-if="updates.update?.body" class="remote-release-notes">{{ updates.update.body }}</pre><label class="update-confirm"><input v-model="confirmed" type="checkbox" />我已保存操作，允许安装更新并中断播放；Windows 安装时会退出程序。</label><button class="primary" :disabled="!confirmed" @click="appUpdates.install(confirmed)"><Download :size="16" />确认安装 v{{ updates.update?.version }}</button></template>
    <div v-if="updateLocked" class="update-progress"><progress :value="updatePercent??undefined" max="100" aria-label="更新下载进度" /><small>{{ updatePercent===null?'正在处理…':`${updatePercent}%` }}<template v-if="updates.received"> · {{ (updates.received/1024/1024).toFixed(1) }} MB</template></small></div>
    <button v-if="updates.phase==='installed'" class="primary" @click="appUpdates.restart()">重启以完成更新</button>
   </section>
   <div class="release-scroll" tabindex="0" aria-label="版本更新记录">
    <article v-for="release in RELEASE_HISTORY" :key="release.version" class="release-entry">
     <div class="release-heading"><h3>{{ release.version==='未发布'?'未发布':`v${release.version}` }}</h3><span v-if="release.version==='未发布'" class="release-badge">开发中</span><span v-else-if="release.version===APP_VERSION" class="release-badge">当前版本</span><time v-if="release.date" :datetime="release.date">{{ release.date }}</time></div>
     <section v-for="group in release.groups" :key="group.title" class="release-group"><h4>{{ group.title }}</h4><ul><li v-for="(item,index) in group.items" :key="index">{{ item }}</li></ul></section>
    </article>
   </div>
   <p class="muted version-history-note">内置日志与 GitHub 检查结果分别显示。只有确认后才会下载并安装，签名验证由原生更新模块执行。</p>
  </section>
 </div></Transition></Teleport>
</template>
