import type { MeshStandardMaterial } from 'three';
/** Imported baked emission must not conceal the user's actual base color. */
export function applyPlinthFinish(material:MeshStandardMaterial,finish:{color:string;roughness:number}){
 material.color.set(finish.color);material.roughness=finish.roughness;
 material.emissive.set(0);material.emissiveIntensity=0;material.emissiveMap=null;
 material.needsUpdate=true;
}
