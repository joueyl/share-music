import { expect, it } from 'vitest';
import { MeshPhysicalMaterial, Texture } from 'three';
import { applyPlinthFinish } from '../src/stage-materials';
import { TURNTABLE_PLINTH_COLORS } from '../src/stage-theme';
it('removes imported baked emission so every plinth preset is visible while preserving surface textures',()=>{
 const map=new Texture(),emissiveMap=new Texture(),normalMap=new Texture();
 const material=new MeshPhysicalMaterial({map,normalMap,emissiveMap,emissive:0xffffff,emissiveIntensity:2.5,clearcoat:.12});
 const version=material.version;
 for(const finish of Object.values(TURNTABLE_PLINTH_COLORS)){
  applyPlinthFinish(material,finish);expect(material.color.getHexString()).toBe(finish.color.slice(1));expect(material.roughness).toBe(finish.roughness);
  expect(material.emissive.getHex()).toBe(0);expect(material.emissiveIntensity).toBe(0);expect(material.emissiveMap).toBeNull();
  expect(material.map).toBe(map);expect(material.normalMap).toBe(normalMap);expect(material.clearcoat).toBe(.12);
 }
 expect(material.version).toBe(version+4);material.dispose();map.dispose();normalMap.dispose();emissiveMap.dispose();
});
