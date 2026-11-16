import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const css=readFileSync(new URL('../src/tone.css',import.meta.url),'utf8');
it('prevents accidental chrome selection while preserving editable and copyable text',()=>{
 expect(css).toContain('body{-webkit-user-select:none;user-select:none}');
 const selectable=css.match(/([^{}]+)\{-webkit-user-select:text;user-select:text\}/)?.[1]??'';
 for(const selector of ['input:not([type=checkbox])','textarea','[contenteditable]:not([contenteditable=false])','[data-selectable]','.chat-message-bubble','.lyric-line','.invite-code','.music-search-message','.library-message','.update-status','.release-scroll','.remote-release-notes','[role=alert]'])expect(selectable).toContain(selector);
 expect(selectable).not.toMatch(/\bbutton\s*,|nav|\.floating-chat-trigger/);
 expect(css).toContain('button,button *,[role=button],[role=button] *,summary,summary *{-webkit-user-select:none;user-select:none}');
});
