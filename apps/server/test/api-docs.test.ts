import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { roomSettingsSchema } from '../../../packages/shared/src';
it('documents every HTTP route and resolves all local OpenAPI references',()=>{
  const doc=JSON.parse(readFileSync('docs/openapi.json','utf8'));
  for(const [file,prefix] of [['controller.ts','/api/'],['netease.controller.ts','/']]) {
    const source=readFileSync('apps/server/src/'+file,'utf8');
    for(const match of source.matchAll(/@(Get|Post|Put)\('([^']+)'\)/g)) {
      const path=(prefix+match[2]).replace(/:([A-Za-z]+)/g,'{$1}');
      expect(doc.paths[path]?.[match[1].toLowerCase()],path).toBeDefined();
    }
  }
  function check(value:any):void {
    if(!value||typeof value!=='object')return;
    if(value.$ref){expect(value.$ref.startsWith('#/')).toBe(true);let target:any=doc;for(const segment of value.$ref.slice(2).split('/'))target=target?.[segment];expect(target,value.$ref).toBeDefined();}
    for(const child of Object.values(value))check(child);
  }
  check(doc);
  expect(Object.keys(doc.components.schemas.RoomSettings.properties).sort()).toEqual(Object.keys(roomSettingsSchema.shape).sort());
  expect(doc.components.schemas.LoginRequest.required).toEqual(['name','password']);
  expect(doc.components.schemas.LoginRequest.properties).not.toHaveProperty('email');
  expect(doc.components.schemas.Profile.properties).not.toHaveProperty('email');
  expect(doc.components.schemas.TrackMetadata.properties).toHaveProperty('sourceUrl');
  expect(doc.components.schemas.TrackMetadata.properties).toHaveProperty('sourceExpiresAt');
  expect(doc.paths['/api/music/upload'].post.requestBody.content).not.toHaveProperty('application/octet-stream');
});
