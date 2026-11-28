<script setup lang="ts">
import { ArrowUp, Flame, Heart, MessageSquare, Music } from 'lucide-vue-next';
import { computed, inject, ref, watch } from 'vue';
import AlbumArt from './AlbumArt.vue';
import { roomCommentsKey } from '../features/useTrackComments';

const props=defineProps<{trackId?:string;netease:boolean;songName?:string;connected:boolean;docked:boolean}>();
const emit=defineEmits<{back:[]}>();
const {hotComments,comments,total,loading,loaded,failed,hasMore,load}=inject(roomCommentsKey)!.state;
const date=new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'short',day:'numeric'});
const groups=computed(()=>[
  {id:'hot',title:'精彩评论',items:hotComments.value},
  {id:'latest',title:'最新评论',items:comments.value},
].filter(group=>group.items.length));
const loadMoreMarker=ref<HTMLElement>();
const autoLoad=typeof IntersectionObserver!=='undefined';
watch(loadMoreMarker,(marker,_,onCleanup)=>{
  if(!marker || !autoLoad)return;
  const observer=new IntersectionObserver(([entry])=>{
    if(props.docked&&props.connected&&marker===loadMoreMarker.value&&marker.isConnected&&entry?.isIntersecting)void load();
  },{root:marker.closest('.desktop-comments-scroll')});
  observer.observe(marker);
  onCleanup(()=>observer.disconnect());
},{flush:'post'});
</script>

<template>
  <section id="room-song-comments" class="song-comments" tabindex="-1" aria-labelledby="room-song-comments-title">
    <header class="comments-header">
      <div class="comments-heading">
        <span class="comment-icon"><MessageSquare :size="20" aria-hidden="true" /></span>
        <div class="comment-title">
          <h2 id="room-song-comments-title">歌曲评论<span v-if="total!==null" class="comment-total">（{{ total.toLocaleString('zh-CN') }}）</span></h2>
          <p v-if="songName" :title="songName">{{ songName }} <span v-if="netease">· 网易云音乐</span></p>
          <p v-else>网易云音乐</p>
        </div>
      </div>
      <button type="button" class="secondary comments-back" @click="emit('back')"><ArrowUp :size="16" aria-hidden="true" /> 返回舞台</button>
    </header>
    <p v-if="!trackId" class="comments-state"><Music :size="19" aria-hidden="true" /> 播放网易云歌曲后可查看评论</p>
    <p v-else-if="!netease" class="comments-state">当前音源不支持网易云评论</p>
    <template v-else>
      <p v-if="!connected" class="comments-state" role="status">连接已断开，恢复后可加载评论</p>
      <p v-else-if="loading&&!loaded" class="comments-state" role="status">正在读取评论…</p>
      <p v-else-if="loaded&&!groups.length" class="comments-state">这首歌暂无评论</p>
      <section v-for="group in groups" :key="group.id" class="comments-group" :class="{'is-hot':group.id==='hot'}">
        <h3><Flame v-if="group.id==='hot'" :size="17" aria-hidden="true" /> {{ group.title }}</h3>
        <ul class="comments-list" :aria-label="group.title">
          <li v-for="comment in group.items" :key="comment.id" class="comment">
            <AlbumArt v-if="comment.avatarUrl" class="comment-avatar" :src="comment.avatarUrl" alt="" />
            <span v-else class="comment-avatar comment-initial" aria-hidden="true">{{ comment.nickname?.slice(0,1) || '♪' }}</span>
            <div class="comment-body">
              <div class="comment-byline">
                <strong class="comment-author">{{ comment.nickname || '网易云用户' }}</strong>
                <time v-if="comment.time!==null" :datetime="new Date(comment.time).toISOString()">{{ date.format(comment.time) }}</time>
              </div>
              <p>{{ comment.content }}</p>
            </div>
            <span v-if="comment.likedCount!==null" class="comment-likes" :aria-label="`获赞 ${comment.likedCount}`"><Heart :size="15" aria-hidden="true" /> {{ comment.likedCount }}</span>
          </li>
        </ul>
      </section>
      <p v-if="failed" class="comments-state" role="status">暂时无法读取评论，请重试</p>
      <p v-else-if="loading&&loaded" class="comments-state" role="status">正在加载更多评论…</p>
      <button v-if="failed||(!autoLoad&&hasMore)" type="button" class="secondary comments-more" :disabled="loading||!connected||!docked" @click="load">{{ failed ? '重试' : '加载更多评论' }}</button>
      <div v-if="autoLoad&&hasMore&&!failed&&!loading&&connected&&docked" ref="loadMoreMarker" class="comments-end-marker" aria-hidden="true" />
    </template>
  </section>
</template>

<style scoped>
.song-comments{min-width:0;display:flex;flex-direction:column;gap:14px;padding:clamp(14px,2.4vw,30px);border-radius:24px;background:rgb(255 255 255 / 62%);color:var(--ink,#283448)}
.song-comments{font-family:"Noto Sans SC","Source Han Sans SC","PingFang SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif}
.song-comments:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.comments-header,.comments-heading,.comments-back,.comment-byline,.comment-likes{display:flex;align-items:center;gap:8px}
.comments-header{justify-content:space-between;flex-wrap:wrap;gap:12px}
.comments-heading,.comment-title,.comment-body{min-width:0}
.comment-icon{display:grid;place-items:center;flex:0 0 44px;height:44px;border-radius:14px;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,white)}
.comment-title h2,.comment-title p,.comment-body p{margin:0}
.comment-title h2{font-size:18px;white-space:nowrap}
.comment-total{display:inline;font-size:12px;font-weight:500;color:var(--muted,#798394)}
.comment-title p{overflow-wrap:anywhere;font-size:12px;color:var(--muted,#798394)}
.comments-group{display:grid;gap:8px}
.comments-group h3{display:flex;align-items:center;gap:6px;margin:2px 0;font-size:15px}
.comments-group.is-hot h3{color:var(--accent)}
.comments-end-marker{min-height:1px}
.comments-list{list-style:none;padding:0;margin:0}
.comment{display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:start;gap:10px;padding:12px 0}
.comment + .comment{border-top:1px solid var(--border,#e1e7ee)}
.comment-avatar{width:36px;height:36px;object-fit:cover;border-radius:50%}
.comment-initial{display:grid;place-items:center;background:#e7effc;color:var(--accent)}
.comment-byline{flex-wrap:wrap;overflow-wrap:anywhere}.comment-byline time,.comment-likes{color:var(--muted,#798394);font-size:12px}
.comment-author{font-size:12px;font-weight:600;color:var(--tone-green)}
.comment-body p{max-inline-size:48em;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;font-weight:400;line-height:1.7;margin-top:4px}
.comment-likes{gap:4px}
.comments-state{display:flex;align-items:center;gap:8px;margin:0;padding:14px 0;color:var(--muted,#798394)}
.comments-more{align-self:flex-start}
.comments-back,.comments-more{min-height:44px}
@media(max-width:520px){.comment{grid-template-columns:30px minmax(0,1fr);padding-block:10px}.comment-avatar{width:30px;height:30px}.comment-likes{grid-column:2}}
</style>
