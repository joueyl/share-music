import { afterEach,expect,it,vi } from 'vitest';
import * as bridge from '../src/bridge';
afterEach(()=>vi.unstubAllGlobals());
const song={source:'netease',id:'1',name:'真实歌曲',artists:'歌手',album:'专辑',coverUrl:'',durationMs:180000,savedAt:1};
it('reads and changes favorite songs without accepting arbitrary user IDs or client metadata',async()=>{
 const request=vi.fn(async()=>Response.json({songs:[song]}));vi.stubGlobal('fetch',request);
 expect(await bridge.favoriteSongs()).toEqual([song]);await bridge.setFavoriteSong('netease','1',true);
 const [url,options]=request.mock.calls[1] as unknown as [string,RequestInit];expect(url).toContain('/api/music/favorite-songs');expect(options.method).toBe('PUT');expect(JSON.parse(String(options.body))).toEqual({source:'netease',id:'1',saved:true});
});
it('rejects corrupt responses and distinguishes missing endpoint errors from empty favorites',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({songs:[{...song,durationMs:-1}]})));await expect(bridge.favoriteSongs()).rejects.toThrow('FAVORITE_SONGS_INVALID');
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:404})));await expect(bridge.favoriteSongs()).rejects.toThrow('HTTP 404');
});
it('uses source IDs rather than transient room UUIDs to favorite playing tracks',()=>{
 expect(bridge.favoriteTrackReference({neteaseId:'1'})).toEqual({source:'netease',id:'1'});expect(bridge.favoriteTrackReference({qqId:'qqmid'})).toEqual({source:'qq',id:'qqmid'});expect(bridge.favoriteTrackReference({})).toBeNull();
});
