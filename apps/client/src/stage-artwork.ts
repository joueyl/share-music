/** Blob-backed images are origin-clean even when the provider CDN has no CORS. */
export function createStageArtworkLoader(load:(url:string)=>Promise<Blob>,publish:(image:HTMLImageElement|null)=>void,createImage=()=>new Image()){
 let generation=0,ownedUrl='',disposed=false,initialized=false,failed=false,source='',trackIdentity='';
 const release=()=>{if(ownedUrl)URL.revokeObjectURL(ownedUrl);ownedUrl='';};
 async function set(url?:string,identity=url??''){
  if(disposed)return;
  const next=url??'';
  if(initialized&&!failed&&next===source&&identity===trackIdentity)return;
  const sameTrack=initialized&&identity===trackIdentity;
  initialized=true;failed=false;source=next;trackIdentity=identity;
  const version=++generation;release();
  // Room snapshots replace track objects frequently. Keep the decoded image for
  // identical inputs, and replace network -> embedded artwork atomically for the
  // same song. Only an actual song/room change or removal clears it immediately.
  if(!sameTrack||!url)publish(null);
  if(!url)return;
  let local='';
  try{
   if(!url.startsWith('blob:')){const blob=await load(url);if(disposed||version!==generation)return;local=URL.createObjectURL(blob);ownedUrl=local;}
   const image=createImage();image.crossOrigin='anonymous';
   const finish=(valid:boolean)=>{if(disposed||version!==generation)return;if(valid&&image.naturalWidth>0&&image.naturalWidth<=8192&&image.naturalHeight>0&&image.naturalHeight<=8192)publish(image);else failed=true;release();};
   image.onload=()=>finish(true);image.onerror=()=>finish(false);image.src=local||url;
  }catch{if(version===generation){failed=true;release();}}
 }
 return {set,dispose(){disposed=true;generation++;release();publish(null);}};
}
