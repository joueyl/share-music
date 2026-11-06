import { expect, it, vi } from 'vitest';
import { diagnoseNeteaseSource } from '../../../scripts/diagnose-netease-source.mjs';

const detailRoute='/api/v3/song/detail',sourceRoute='/api/song/enhance/player/url';
it('makes one fixed anonymous metadata request without using ambient credentials or returning private data',async()=>{
 const request=vi.fn(async()=>({status:200,body:{code:200,cookie:'private',[detailRoute]:{code:200,songs:[{id:42,name:'private title'}]},[sourceRoute]:{code:200,data:[{id:42,code:200,url:'https://private.example/token',freeTrialInfo:{private:'trial'}}]}}}));
 const result=await diagnoseNeteaseSource('42',request);
 expect(request).toHaveBeenCalledOnce();
 const [path,data,config]=request.mock.calls[0];
 expect(path).toBe('/api/batch');
 expect(JSON.parse(data[detailRoute])).toEqual({c:'[{"id":42}]'});
 expect(JSON.parse(data[sourceRoute])).toEqual({ids:'["42"]',br:128000});
 expect(config).toEqual({cookie:'',timeoutMs:15000,retry:{retries:0,retryNonIdempotent:false}});
 expect(result).toMatchObject({mode:'anonymous',outcome:'metadata_received',rootCode:200,detailCode:200,sourceCode:200,hasAudioUrl:true,trialOnly:true});
 expect(JSON.stringify(result)).not.toContain('private');
});
it('reports a nested -460 without retrying or inventing a successful playback result',async()=>{
 const request=vi.fn(async()=>({status:200,body:{code:200,[detailRoute]:{code:200,songs:[{id:42}]},[sourceRoute]:{code:-460,msg:'private message'}}}));
 expect(await diagnoseNeteaseSource('42',request)).toMatchObject({outcome:'response_rejected',rootCode:200,detailCode:200,sourceCode:-460,hasAudioUrl:false});
 expect(request).toHaveBeenCalledOnce();
});
it('sanitizes request failures and rejects invalid IDs before loading the SDK or calling the network',async()=>{
 const request=vi.fn(async()=>{throw {status:400,body:{code:-460,msg:'private',cookie:'private'}};});
 expect(await diagnoseNeteaseSource('42',request)).toEqual({mode:'anonymous',outcome:'request_failed',stage:'request',sdkStatus:400,bodyCode:-460});
 expect(request).toHaveBeenCalledOnce();request.mockClear();
 for(const id of ['', '0', '00042', '42,43', 'http://private', '0'.repeat(21)])await expect(diagnoseNeteaseSource(id,request)).rejects.toThrow('INVALID_SONG_ID');
 expect(request).not.toHaveBeenCalled();
});
