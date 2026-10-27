import { expect, it } from 'vitest';
import { Database } from '../src/database';
import { ApiController } from '../src/controller';
import { DomainError } from '../src/engine';
import type { AppService } from '../src/app.service';
import type { TrackMetadata } from '../../../packages/shared/src';

it('lists only registered uploads in the active OSS scope, deduplicates files and preserves local filenames',()=>{
 const db=new Database(':memory:');
 try{
  const scope='region:bucket',hash='a'.repeat(64),key=`music/files/${hash}/测试音乐.mp3`;
  const track={name:'歌曲一',artists:'歌手甲',album:'专辑乙',contentHash:hash,ossKey:key,durationMs:123000,sizeBytes:2048} as TrackMetadata;
  db.saveAsset(scope,hash,key);db.saveMusicSource(scope,'netease:standard:1',track);
  db.saveMusicSource(scope,'netease:standard:2',track);
  db.saveMusicSource(scope,'not-uploaded',{...track,contentHash:'b'.repeat(64),name:'未上传'});
  db.saveAsset('other:bucket','c'.repeat(64),'music/files/other/private.mp3');
  db.saveMusicSource('other:bucket','other',{...track,name:'其他存储的音乐'});
  db.saveAsset(scope,'d'.repeat(64),`music/files/${'d'.repeat(64)}/本地音频.flac`);
  expect(db.uploadedMusic(scope,'',0,20)).toEqual({total:2,songs:[
   {id:'d'.repeat(64),name:'本地音频.flac',artists:'',album:'',coverUrl:'',canAdd:false,durationMs:null,sizeBytes:null},
   {id:hash,name:'歌曲一',artists:'歌手甲',album:'专辑乙',coverUrl:'',canAdd:false,durationMs:123000,sizeBytes:2048},
  ]});
  for(const term of ['歌曲一','歌手甲','专辑乙','测试音乐'])expect(db.uploadedMusic(scope,term,0,20).songs.map(s=>s.id)).toEqual([hash]);
  expect(db.uploadedMusic(scope,'',1,1).songs[0].id).toBe(hash);
  expect(db.uploadedMusic(scope,'',20,20)).toEqual({total:2,songs:[]});
  expect(db.uploadedMusic(scope,"' OR 1=1 --",0,20)).toEqual({total:0,songs:[]});
  expect(db.uploadedMusic(scope,'未上传',0,20).total).toBe(0);
 }finally{db.close();}
});

it('authenticates and validates uploaded music queries before reading storage',()=>{
 const db=new Database(':memory:');
 const controller=new ApiController({database:db,oss:{scope:()=> 'scope'},limit:()=>{},auth:{verify:(token:string)=>{
  if(token!=='valid')throw new DomainError('UNAUTHORIZED');return {id:'user'};
 }}} as unknown as AppService);
 try{
  expect(()=>controller.uploadedMusic({})).toThrow();
  expect(()=>controller.uploadedMusic({},'Bearer invalid')).toThrow();
  expect(controller.uploadedMusic({},'Bearer valid')).toEqual({songs:[],total:0});
  for(const query of [{offset:-1},{offset:'bad'},{limit:101},{limit:0},{keywords:'x'.repeat(101)},{scope:'other'},{offset:1.5}])expect(()=>controller.uploadedMusic(query,'Bearer valid')).toThrow();
 }finally{db.close();}
});

it('fills missing artists, album and artwork from SQLite song details and searches those fields',()=>{
 const db=new Database(':memory:');
 try{
  const scope='region:bucket',hash='e'.repeat(64),key=`music/files/${hash}/旧歌曲.mp3`;
  const track={name:'旧歌曲',contentHash:hash,ossKey:key,durationMs:123000,sizeBytes:2048} as TrackMetadata;
  db.saveAsset(scope,hash,key);db.saveMusicSource(scope,'netease:standard:10',track);
  db.saveMusicDetail(scope,'netease:standard:10',{name:'旧歌曲',ar:[{name:'歌手甲'},{name:'歌手乙'},{name:'歌手甲'}],al:{name:'详情专辑',picUrl:'https://p1.music.126.net/cover.jpg'}});
  // Another source for identical audio must not hide the saved details or duplicate the file.
  db.saveMusicSource(scope,'netease:standard:11',track);
  db.saveMusicDetail('other:bucket','netease:standard:10',{ar:[{name:'其他存储歌手'}],al:{name:'其他专辑'}});
  const result=db.uploadedMusic(scope,'',0,20);
  expect(result.total).toBe(1);expect(result.songs[0]).toMatchObject({artists:'歌手甲 / 歌手乙',album:'详情专辑',coverUrl:'https://p1.music.126.net/cover.jpg'});
  for(const term of ['歌手甲','歌手乙','详情专辑'])expect(db.uploadedMusic(scope,term,0,20)).toEqual(result);
  expect(db.uploadedMusic(scope,'其他存储歌手',0,20).total).toBe(0);
  // Also support the older artists/album detail shape and empty simplified fields.
  db.saveMusicSource(scope,'netease:standard:10',{...track,artists:' ',album:''});
  db.saveMusicDetail(scope,'netease:standard:10',{artists:[{name:'旧版歌手'}],album:{name:'旧版专辑'}});
  expect(db.uploadedMusic(scope,'旧版歌手',0,20).songs[0]).toMatchObject({artists:'旧版歌手',album:'旧版专辑'});
  db.saveMusicSource(scope,'netease:standard:10',{...track,artists:'已保存歌手',album:'已保存专辑'});
  expect(db.uploadedMusic(scope,'',0,20).songs[0]).toMatchObject({artists:'已保存歌手',album:'已保存专辑'});
 }finally{db.close();}
});
