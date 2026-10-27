export type ReleaseEntry={version:string;date:string;groups:{title:string;items:string[]}[]};
// Only render a small text-only Markdown subset; never inject changelog HTML.
export function parseChangelog(markdown:string):ReleaseEntry[]{
 const releases:ReleaseEntry[]=[];let current:ReleaseEntry|undefined,group:ReleaseEntry['groups'][number]|undefined;
 for(const line of markdown.split(/\r?\n/)){
  const heading=/^## \[([^\]]+)\](?:\s*-\s*(.*))?$/.exec(line);
  if(heading){current={version:heading[1],date:heading[2]??'',groups:[]};releases.push(current);group=undefined;continue;}
  if(!current)continue;
  const category=/^### (.+)$/.exec(line);
  if(category){group={title:category[1],items:[]};current.groups.push(group);continue;}
  const item=/^- (.+)$/.exec(line);
  if(item){if(!group){group={title:'更新内容',items:[]};current.groups.push(group);}group.items.push(item[1]);}
 }
 return releases.filter(entry=>entry.groups.some(group=>group.items.length));
}
