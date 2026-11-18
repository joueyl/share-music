import { onMounted,onUnmounted,ref,watch } from 'vue';
import { useRouter } from 'vue-router';
import { useApp } from '../store';
import { ui } from '../ui';
import * as bridge from '../bridge';
import type { RoomSnapshot } from '@music-share/shared';
/** Shared domain controller: desktop and APK must use the same request/permission flow. */
export function useRoomDiscovery(){
const app=useApp(),router=useRouter(),rooms=ref<bridge.RoomSummary[]>([]),creating=ref(false),codeOpen=ref(false),code=ref(''),keywords=ref(ui.roomKeywords),category=ref(''),loading=ref(false),joining=ref<string|null>(null),resolving=ref(false);
const moods:Record<string,string>={sunset:'SLOW\nAFTERNOON',night:'AFTER\nHOURS',weekend:'SUNDAY\nSOMEWHERE',custom:'YOUR\nFREQUENCY'};
const loadError=ref(false);
let generation=0,timer:ReturnType<typeof setInterval>;
async function load(){const gen=++generation;loading.value=true;loadError.value=false;try{const data=await bridge.listRooms(keywords.value,category.value);if(gen===generation)rooms.value=data;}catch(e){if(gen===generation){loadError.value=true;app.error(e);}}finally{if(gen===generation)loading.value=false;}}
async function enter(id:string){const target=rooms.value.find(r=>r.id===id);if(joining.value||!app.connected||target&&target.members>=target.maxMembers)return;joining.value=id;try{await bridge.join(id);await router.push(`/room/${id}`);}catch(e){app.error(e);}finally{joining.value=null;}}
async function resolve(){if(resolving.value)return;resolving.value=true;try{await enter((await bridge.resolveRoom(code.value)).id);codeOpen.value=false;}catch(e){app.error(e);}finally{resolving.value=false;}}
async function created(room:RoomSnapshot){creating.value=false;await load();await enter(room.id);}
watch(()=>ui.roomKeywords,term=>{keywords.value=term;void load();});
onMounted(()=>{void load();timer=setInterval(()=>{if(!loading.value&&!creating.value)void load();},10000);});onUnmounted(()=>{generation++;clearInterval(timer);});

return { app,router,rooms,creating,codeOpen,code,keywords,category,loading,joining,resolving,moods,loadError,load,enter,resolve,created };
}
