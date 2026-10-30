<script setup lang="ts">
import { ref } from 'vue';
import { X, Check, Users, Link, Headphones } from 'lucide-vue-next';
import { useApp } from '../store';
import { createRoom, updateRoomSettings, type RoomSettings } from '../bridge';
import { useDialogFocus } from '../useDialogFocus';
import type { RoomSnapshot } from '@music-share/shared';
const props=defineProps<{create?:boolean}>();
const app=useApp(),emit=defineEmits<{close:[];created:[room:RoomSnapshot]}>(),dialog=ref<HTMLElement|null>(null);
const name=ref(props.create?'':app.room?.name??'');
const settings=ref<RoomSettings>({description:'',atmosphere:'sunset',visibility:'public',category:'',coverUrl:null,...(!props.create?app.room?.settings:{})});
const saving=ref(false),enqueue=ref(true),hostOnly=ref(true);
const moods=[{id:'sunset',name:'日落山谷'},{id:'night',name:'深夜电台'},{id:'weekend',name:'慵懒周末'},{id:'custom',name:'自定义'}] as const;
function close(){if(!saving.value)emit('close');}useDialogFocus(dialog,close);
async function save(){
 if(saving.value||!app.connected||(!props.create&&(!app.room||!app.host)))return;saving.value=true;
 try{
  if(props.create){const room=await createRoom(name.value,settings.value,{skip:!hostOnly.value,seek:!hostOnly.value,stream:false,enqueue:enqueue.value});emit('created',room);emit('close');}
  else if(app.room){const room=await updateRoomSettings(app.room,name.value,settings.value);if(app.room?.id===room.id&&app.room.stateVersion<=room.stateVersion)app.room=room;emit('close');}
 }catch(e){app.error(e);}finally{saving.value=false;}
}
</script>
<template><Teleport to="body"><div class="modal-backdrop tone-modal-backdrop" @click.self="close"><form ref="dialog" class="tone-dialog room-editor" role="dialog" aria-modal="true" :aria-label="create?'创建音乐房间':'房间设置'" @submit.prevent="save"><header class="dialog-heading"><div><h2>{{ create?'让喜欢的歌，有人一起听':'房间设置' }}</h2><p>{{ create?'创建一个属于你们的音乐小空间':'把此刻的房间，调成喜欢的样子' }}</p></div><button type="button" class="round-close" :disabled="saving" aria-label="关闭房间设置" @click="close"><X :size="20" /></button></header>
 <label class="editor-name">房间名称<span><input v-model="name" :disabled="saving" autofocus required maxlength="80" placeholder="例如：日落之前的慢半拍" /><small>{{ name.length }}/80</small></span></label>
 <fieldset class="mood-field"><legend>房间氛围</legend><div class="mood-options"><button v-for="mood in moods" :key="mood.id" type="button" class="mood-option" :class="[mood.id,{selected:settings.atmosphere===mood.id}]" :disabled="saving" :aria-pressed="settings.atmosphere===mood.id" @click="settings.atmosphere=mood.id"><i class="mood-sun" /><i class="mood-hill hill-back" /><i class="mood-hill hill-front" /><span>{{ mood.name }}</span><Check v-if="settings.atmosphere===mood.id" :size="15" /></button></div></fieldset>
 <fieldset class="visibility-field"><legend>谁可以加入</legend><div class="visibility-options"><button type="button" :class="{selected:settings.visibility==='public'}" :disabled="saving" :aria-pressed="settings.visibility==='public'" @click="settings.visibility='public'"><Users :size="20" /><span><strong>公开房间</strong><small>让同频的人发现你</small></span><i /></button><button type="button" :class="{selected:settings.visibility==='invite'}" :disabled="saving" :aria-pressed="settings.visibility==='invite'" @click="settings.visibility='invite'"><Link :size="20" /><span><strong>仅限邀请</strong><small>通过房间码或链接加入</small></span><i /></button></div></fieldset>
 <template v-if="create"><label class="editor-toggle"><span><strong>允许所有成员点歌</strong><small>大家都可以将歌曲添加到共享歌单</small></span><input v-model="enqueue" type="checkbox" :disabled="saving" role="switch" /></label><label class="editor-toggle"><span><strong>仅房主控制播放</strong><small>保持统一节奏，避免频繁切歌</small></span><input v-model="hostOnly" type="checkbox" :disabled="saving" role="switch" /></label></template>
 <details class="editor-extra"><summary>更多设置：介绍与分类</summary><label>房间介绍<textarea v-model="settings.description" maxlength="500" :disabled="saving" /></label><label>分类<input v-model="settings.category" maxlength="40" :disabled="saving" placeholder="例如：民谣、轻音乐" /></label></details>
 <button class="primary editor-submit" :disabled="saving||!app.connected" :aria-busy="saving"><Headphones :size="17" />{{ saving?'正在保存…':create?'创建房间，开始一起听':'保存房间设置' }}</button><p class="editor-footnote">{{ create?'创建后可随时调整房间设置':'成员权限可在房间成员面板中单独调整' }}</p>
 </form></div></Teleport></template>
