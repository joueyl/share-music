import { expect,it } from 'vitest';
import { scrobbleResponseLog } from '../src/scrobble-response';

it('preserves response values but redacts nested and inline authentication',()=>{
 const line=scrobbleResponseLog({code:200,data:{ok:true,message:'成功',access_token:'private-1',headers:{Authorization:'private-2'},nested:[{MUSIC_A:'private-3'}],note:'MUSIC_U=private-4;',json:'{"refresh_token":"private-5"}',bearer:'Bearer private-6'}});
 expect(line).toContain('"code":200');expect(line).toContain('"message":"成功"');
 expect(line).toContain('[REDACTED]');expect(line).not.toContain('private-');
});
it('bounds total output, depth, arrays and cyclic data without injecting lines',()=>{
 const cyclic:any={};cyclic.self=cyclic;
 expect(scrobbleResponseLog(cyclic)).toContain('[CIRCULAR]');
 const line=scrobbleResponseLog({code:200,data:Array.from({length:1000},()=>({text:'x'.repeat(10000)+'\nforged log'}))});
 expect(line.length).toBeLessThanOrEqual(2060);expect(line).toContain('[TRUNCATED]');expect(line).not.toContain('\n');
 expect(scrobbleResponseLog({message:'first\nsecond'})).toContain('first\\nsecond');
 const deep={data:{a:{b:{c:{d:{secret:'private'}}}}}};
 expect(scrobbleResponseLog(deep)).not.toContain('private');
});
it('does not let malformed diagnostic values throw into the listening queue',()=>{
 expect(scrobbleResponseLog({data:1n})).toContain('[UNAVAILABLE]');
 expect(scrobbleResponseLog({get data(){throw Error('private');}})).toBe('网易云听歌打卡响应 [UNAVAILABLE]');
});
