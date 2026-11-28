type Region = 'stage' | 'comments';
type ScrollGeometry = { top:number; viewport:number; stageEnd:number; dock:number };

/** Snap only between the two sections; long stage and comment content scroll normally. */
export function roomCommentSnap(from:Region,{top,viewport,stageEnd,dock}:ScrollGeometry):{region:Region;target?:number} {
  if(top<=stageEnd+1)return {region:'stage'};
  if(top>=dock-1)return {region:'comments',target:from==='stage'?dock:undefined};
  const threshold=Math.min((dock-stageEnd)/2,Math.max(56,Math.min(144,viewport*.22)));
  const comments=from==='stage'?top-stageEnd>=threshold:dock-top<threshold;
  return comments?{region:'comments',target:dock}:{region:'stage',target:stageEnd};
}
