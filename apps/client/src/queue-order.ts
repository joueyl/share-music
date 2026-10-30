/** Reorder the complete queue, including the playing track; never drop IDs. */
export function moveQueueTrack(ids:string[],source:string,target:string,after=false):string[] {
  if(source===target||!ids.includes(source)||!ids.includes(target))return [...ids];
  const order=ids.filter(id=>id!==source),index=order.indexOf(target);
  order.splice(index+(after?1:0),0,source);return order;
}
