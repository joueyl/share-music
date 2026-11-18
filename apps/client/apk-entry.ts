import type { Plugin } from 'vite';

/** Fail the APK build if a desktop page/style is accidentally imported. */
export function apkEntryPlugin(): Plugin {
 return {
  name:'tone-independent-apk-entry',
  enforce:'post',
  generateBundle:{order:'post',handler(_options,bundle){
   const forbidden=[...this.getModuleIds()].filter(id=>/\/src\/(?:App\.vue|views\/|components\/(?:AuthPage|GlobalPlayer)\.vue|(?:style|responsive|tone|brilliant|adaptive-layout)\.css)/.test(id.replace(/\\/g,'/')));
   if(forbidden.length)this.error('APK 不得加载桌面页面或布局样式：'+forbidden.join(', '));
   const html=bundle['apk.html'];
   if(!html||html.type!=='asset')this.error('APK 独立 HTML 入口未生成');
   delete bundle['apk.html'];html.fileName='index.html';bundle['index.html']=html;
   this.emitFile({type:'asset',fileName:'client-target.json',source:JSON.stringify({target:'apk',entry:'src/apk/main.ts',desktopModules:0})});
  }},
 };
}
