import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
import { listRooms, createRoom, resolveRoom, updateRoomSettings } from '../src/bridge';
import type { RoomSnapshot } from '@music-share/shared';
afterEach(() => vi.unstubAllGlobals());
function http() { const fetch = vi.fn(async () => new Response(JSON.stringify({id:'room'}), {headers:{'Content-Type':'application/json'}})); vi.stubGlobal('fetch', fetch); return fetch; }
it('uses backend room filters and encodes the invite code path', async () => {
 const fetch = http(); await listRooms(' 日落 ', '民谣');
 const query = new URL('http://test'+fetch.mock.calls[0][0]).searchParams;
 expect(query.get('keywords')).toBe('日落'); expect(query.get('category')).toBe('民谣');
 await resolveRoom('aabbcc112233'); expect(fetch.mock.calls[1][0]).toBe('/api/rooms/resolve/aabbcc112233');
});
it('creates rooms with API settings rather than fabricating client-side rooms', async () => {
 const fetch = http(); const settings = {description:'音乐时刻',atmosphere:'night' as const,visibility:'invite' as const};
 await createRoom(' 同频 ', settings);
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({name:'同频',settings});
});
it('replaces all settings via PUT with optimistic concurrency and never silently retries conflicts', async () => {
 const fetch = http(); const settings = {description:'',atmosphere:'sunset' as const,visibility:'public' as const,category:'',coverUrl:null};
 await updateRoomSettings({id:'room',stateVersion:7} as RoomSnapshot,' 新名字 ',settings);
 expect(fetch.mock.calls[0][1].method).toBe('PUT');
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({name:'新名字',settings,expectedStateVersion:7});
 fetch.mockImplementation(async () => new Response(JSON.stringify({error:'STATE_CONFLICT'}),{status:400}));
 await expect(updateRoomSettings({id:'room',stateVersion:7} as RoomSnapshot,'新名字',settings)).rejects.toThrow('STATE_CONFLICT');
 expect(fetch).toHaveBeenCalledTimes(2);
});
it('sends create-dialog permission toggles in the documented complete defaults shape', async () => {
 const fetch=http();const defaults={skip:false,seek:false,stream:false,enqueue:true};await createRoom('房间',{atmosphere:'sunset',visibility:'invite'},defaults);
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({name:'房间',settings:{atmosphere:'sunset',visibility:'invite'},defaults});
});
