<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Headphones, ArrowLeft, UserRound, LockKeyhole, Eye, EyeOff, ShieldCheck, LoaderCircle } from 'lucide-vue-next';
import { useApp } from '../store';
import { canRememberLogin, clearSavedLogin } from '../saved-login';
import turntable from '../assets/login-turntable.svg';
const emit = defineEmits<{ version: [] }>();
const app = useApp(), router = useRouter();
const name = ref(''), password = ref(''), confirmation = ref(''), register = ref(false);
const showPassword = ref(false), showConfirmation = ref(false);
const remember = ref(false), rememberAvailable = ref(false), starting = ref(true);
const confirmInput = ref<HTMLInputElement | null>(null);
watch(register, () => { password.value = ''; confirmation.value = ''; showPassword.value = false; showConfirmation.value = false; });
watch([password, confirmation], () => confirmInput.value?.setCustomValidity(''));
onMounted(async () => {
  try {
    await app.initialize();
    rememberAvailable.value = await canRememberLogin();
    if (rememberAvailable.value) {
      const saved = await app.restoreLogin();
      if (saved) { name.value = saved.name; remember.value = true; }
    }
  } catch (e) { app.error(e); }
  finally { starting.value = false; }
});
async function changeRemember() {
  if (!remember.value) try { await clearSavedLogin(); } catch (e) { app.error(e); }
}
async function submit() {
  if (starting.value || app.busy) return;
  if (register.value && confirmation.value !== password.value) {
    confirmInput.value?.setCustomValidity('两次输入的密码不一致');
    confirmInput.value?.reportValidity(); return;
  }
  await app.login(name.value, password.value, register.value, rememberAvailable.value && remember.value);
  if (app.user) { password.value = ''; confirmation.value = ''; }
}
function home() { register.value = false; void router.replace('/'); }
</script>
<template>
  <div class="auth-page">
    <header class="auth-header">
      <button type="button" class="auth-brand" aria-label="同频首页" @click="home"><span class="auth-brand-mark"><Headphones :size="20" /></span><strong>同频</strong><small>T O N E</small></button>
      <button type="button" class="auth-back" @click="home"><ArrowLeft :size="18" />返回首页</button>
    </header>
    <div class="auth-content">
      <section class="auth-intro" aria-label="同频音乐陪伴">
        <span class="auth-eyebrow">MUSIC SOUNDS BETTER TOGETHER</span>
        <h1>有人和你，<br>听见同一秒。</h1>
        <p>把喜欢的歌分享给喜欢的人，让陪伴不受距离限制。</p>
        <img class="auth-turntable" :src="turntable" alt="唱机与山谷唱片插画，每一秒都同频" width="554" height="517" />
      </section>
      <form class="auth-card" :class="{ 'auth-register': register }" aria-label="账号登录与注册" @submit.prevent="submit">
        <h2>{{ register ? '注册，遇见同频的人' : '欢迎回到同频' }}</h2>
        <p class="auth-subtitle">{{ register ? '创建账号，把每一份喜欢分享出去。' : '你的耳机里，今天会多一个人的陪伴。' }}</p>
        <div class="auth-tabs" aria-label="账号操作">
          <button type="button" :class="{ active: !register }" :aria-pressed="!register" :disabled="starting || app.busy" @click="register = false">登录</button>
          <button type="button" :class="{ active: register }" :aria-pressed="register" :disabled="starting || app.busy" @click="register = true">注册</button>
        </div>
        <label class="auth-field">用户名<span class="auth-input"><UserRound :size="18" /><input v-model="name" :disabled="starting || app.busy" autocomplete="username" minlength="2" maxlength="40" required placeholder="请输入用户名" /></span></label>
        <label class="auth-field">{{ register ? '设置密码' : '密码' }}<span class="auth-input"><LockKeyhole :size="18" /><input v-model="password" :disabled="starting || app.busy" :type="showPassword ? 'text' : 'password'" :autocomplete="register ? 'new-password' : 'current-password'" minlength="10" maxlength="128" required :placeholder="register ? '10–128 位密码' : '请输入密码'" /><button type="button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" :disabled="starting || app.busy" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="18" /><Eye v-else :size="18" /></button></span></label>
        <label v-if="register" class="auth-field">确认密码<span class="auth-input"><LockKeyhole :size="18" /><input ref="confirmInput" v-model="confirmation" :disabled="starting || app.busy" :type="showConfirmation ? 'text' : 'password'" autocomplete="new-password" minlength="10" maxlength="128" required placeholder="请再次输入密码" /><button type="button" :aria-label="showConfirmation ? '隐藏确认密码' : '显示确认密码'" :disabled="starting || app.busy" @click="showConfirmation = !showConfirmation"><EyeOff v-if="showConfirmation" :size="18" /><Eye v-else :size="18" /></button></span></label>
        <div class="auth-options">
          <label class="auth-remember" :title="rememberAvailable ? '仅在个人设备启用；凭据由系统安全保存，退出登录会清除' : '当前环境不支持安全保存登录凭据'"><input v-model="remember" type="checkbox" :disabled="!rememberAvailable || starting || app.busy" @change="changeRemember" /><span>记住登录状态</span></label>
          <button v-if="!register" type="button" class="auth-forgot" @click="app.notice = '当前服务端暂不支持自助找回密码，请联系管理员'">忘记密码</button>
          <span v-else class="auth-password-hint">密码为 10–128 位</span>
        </div>
        <button class="auth-submit" :disabled="starting || app.busy" :aria-busy="starting || app.busy"><LoaderCircle v-if="starting || app.busy" class="spinning" :size="18" /><Headphones v-else :size="18" />{{ starting || app.busy ? '连接中…' : register ? '注册并开始听歌' : '登录，一起听' }}</button>
        <div class="auth-switch"><span>{{ register ? '已有账号？' : '还没有账号？' }}</span><button type="button" :disabled="starting || app.busy" @click="register = !register">{{ register ? '返回登录' : '立即注册' }}</button></div>
        <p class="auth-security"><ShieldCheck :size="14" />安全登录，安心分享每一首歌</p>
      </form>
    </div>
    <footer class="auth-footer"><button type="button" @click="emit('version')">© 2026 同频 TONE</button><span>音乐是入口，陪伴才是目的。</span></footer>
  </div>
</template>
<style scoped>
.auth-page{position:relative;max-width:1440px;min-height:100dvh;margin:auto;font-family:"Microsoft YaHei","Segoe UI",sans-serif;color:#283448}
.auth-header{position:absolute;left:48px;right:112px;top:32px;height:40px;display:flex;align-items:center;justify-content:space-between}
.auth-brand{display:flex;align-items:center;gap:12px;padding:0;background:none}.auth-brand-mark{display:grid;place-items:center;width:40px;height:40px;border-radius:13px;background:#4f80db;color:white}.auth-brand strong{font-size:23px;font-weight:700}.auth-brand small{font-size:10px;color:#798394;margin-left:3px;white-space:nowrap}.auth-back{background:none;font-size:12px;color:#798394;padding:8px 0;gap:9px}
.auth-content{display:grid;grid-template-columns:minmax(0,1fr) 478px;gap:clamp(40px,14.58vw,210px);padding:175px 112px 140px 84px;align-items:start}
.auth-intro{position:relative;min-height:644px}.auth-eyebrow{display:block;font-size:10px;font-weight:500;line-height:13px;color:#4f80db}.auth-intro h1{font-size:45px;line-height:62px;font-weight:500;letter-spacing:0;margin:26px 0 4px}.auth-intro>p{font-size:14px;line-height:1.6;color:#798394;white-space:nowrap;margin:0;position:relative;z-index:1}.auth-turntable{display:block;position:absolute;top:127px;left:1px;width:554px;height:517px;max-width:none;pointer-events:none}
.auth-card{position:relative;width:478px;min-height:624px;padding:34px 41px 20px;background:#fff;border:1px solid #fff;border-radius:26px;box-shadow:0 12px 40px #4e668212}
.auth-card h2{font-size:27px;line-height:36px;font-weight:500;margin:0 0 6px}.auth-subtitle{font-size:12px;line-height:16px;color:#798394;margin:0}.auth-tabs{display:flex;height:43px;padding:4px;background:#eff3f7;border-radius:13px;margin:26px 0 28px;gap:4px}.auth-tabs button{flex:1;background:transparent;border-radius:10px;color:#798394;font-size:13px;font-weight:500}.auth-tabs .active{background:#fff;color:#4f80db}
.auth-field{display:flex;flex-direction:column;gap:7px;font-size:12px;color:#283448;margin:0 0 19px;line-height:16px}.auth-input{display:flex;align-items:center;gap:14px;height:52px;border:1px solid #dce4ec;border-radius:12px;padding:0 15px;background:white;color:#798394}.auth-input:focus-within{border-color:#4f80db;box-shadow:0 0 0 3px #4f80db12}.auth-input>svg{flex-shrink:0}.auth-input input{min-width:0;flex:1;width:100%;height:100%;border:0!important;outline:none!important;background:none;padding:0;color:#283448;font-size:13px;box-shadow:none}.auth-input input::placeholder{color:#929caa}.auth-input button{width:24px;height:32px;flex-shrink:0;padding:0;background:none;color:#929caa}.auth-options{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:24px 0 28px;min-height:20px}.auth-remember{flex-direction:row;align-items:center;gap:9px;margin:0;font-size:11px;color:#798394;line-height:15px}.auth-remember input{width:15px;height:15px;margin:0;accent-color:#4f80db}.auth-remember input:disabled{opacity:.5}.auth-forgot{background:none;color:#4f80db;padding:0;font-size:11px}.auth-password-hint{font-size:11px;color:#798394}
.auth-submit{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:48px;border-radius:24px;background:#4f80db;color:white;font-size:13px;font-weight:500}.auth-submit:hover:not(:disabled){background:#4272c9}.auth-switch{display:flex;align-items:center;justify-content:center;gap:8px;border-top:1px solid #e6ebef;margin-top:37px;padding-top:24px;color:#798394;font-size:12px;line-height:20px}.auth-switch button{padding:0;background:none;color:#4f80db;font-size:12px}.auth-security{display:flex;align-items:center;justify-content:center;gap:8px;color:#8c9a96;font-size:10px;line-height:14px;margin:26px 0 0}
.auth-register{margin-top:-22px;min-height:658px}.auth-register .auth-tabs{margin-bottom:18px}.auth-register .auth-field{margin-bottom:12px}.auth-register .auth-options{margin:16px 0 20px}.auth-register .auth-switch{margin-top:20px;padding-top:16px}.auth-register .auth-security{margin-top:20px}
.auth-footer{position:absolute;left:48px;right:173px;bottom:32px;display:flex;align-items:center;justify-content:space-between;color:#8c95a1;font-size:11px}.auth-footer button{padding:0;background:none;color:inherit;font-size:10px}
@media(max-width:1250px) and (min-width:901px){.auth-content{padding-left:5.83%;padding-right:7.78%;gap:40px;grid-template-columns:minmax(0,1fr) 430px}.auth-card{width:430px;padding-left:32px;padding-right:32px}.auth-turntable{width:480px;height:auto;left:-30px}.auth-intro h1{font-size:40px}.auth-intro>p{white-space:normal;font-size:13px}.auth-header{right:7.78%}}
@media(max-width:900px){.auth-page{min-height:100dvh}.auth-header{position:relative;inset:auto;padding:24px;height:auto}.auth-content{display:block;padding:50px 24px 100px}.auth-intro{display:none}.auth-card{width:100%;max-width:478px;margin:0 auto;min-height:624px}.auth-register{margin-top:0}.auth-footer{left:24px;right:24px;bottom:24px}.auth-footer>span{font-size:10px}}
@media(max-width:480px){.auth-header{padding:20px}.auth-brand{gap:9px}.auth-brand strong{font-size:20px}.auth-brand small{font-size:8px}.auth-back{font-size:11px}.auth-content{padding:28px 16px 96px}.auth-card{min-height:0;padding:28px 24px;border-radius:24px}.auth-card h2{font-size:24px}.auth-subtitle{font-size:11px}.auth-input input{font-size:16px}.auth-tabs button,.auth-input button,.auth-forgot,.auth-switch button{min-height:35px}.auth-options{margin:16px 0 24px;gap:8px}.auth-switch{margin-top:28px}.auth-security{margin-bottom:0}.auth-footer{gap:16px;position:relative;inset:auto;padding:0 20px 24px;flex-wrap:wrap}.auth-register .auth-options{align-items:flex-start;flex-wrap:wrap}}
@media(min-width:901px) and (max-height:900px){
 .auth-page{display:flex;flex-direction:column}
 .auth-header{position:relative;inset:auto;height:auto;padding:20px 7.78% 16px 3.33%;flex-shrink:0}
 .auth-content{flex:1;padding:12px 7.78% 16px 5.83%;align-items:center;gap:clamp(32px,8vw,120px)}
 .auth-intro{min-height:0;height:auto;display:flex;flex-direction:column;justify-content:flex-start}
 .auth-intro h1{font-size:clamp(30px,4.6vh,42px);line-height:1.4;margin-top:16px}
 .auth-turntable{position:relative;inset:auto;width:min(100%,calc((100dvh - 380px)*1.07),500px);height:auto;margin-top:10px}
 .auth-card,.auth-register{min-height:0;margin-top:0;padding:24px 32px 20px}
 .auth-tabs{margin:18px 0}
 .auth-field,.auth-register .auth-field{margin-bottom:12px}
 .auth-input{height:44px}
 .auth-options,.auth-register .auth-options{margin:16px 0}
 .auth-switch,.auth-register .auth-switch{margin-top:20px;padding-top:16px}
 .auth-security,.auth-register .auth-security{margin-top:16px}
 .auth-register{padding-top:20px;padding-bottom:16px}
 .auth-register .auth-tabs{margin:14px 0}
 .auth-register .auth-field{margin-bottom:8px}
 .auth-register .auth-options{margin:12px 0}
 .auth-footer{position:relative;inset:auto;padding:16px 7.78% 20px 3.33%;flex-shrink:0}
}
@media(max-width:900px){
 .auth-page{display:flex;flex-direction:column}
 .auth-content{flex:1;display:grid;grid-template-columns:minmax(0,1fr);gap:0;place-items:center;padding:20px 24px}
 .auth-card{min-height:0}
 .auth-footer{position:relative;inset:auto;padding:16px 24px 24px;flex-shrink:0;gap:12px;flex-wrap:wrap}
}
@media(max-width:480px){.auth-content{padding:12px 16px 20px}.auth-footer{padding-left:20px;padding-right:20px}}
@media(min-width:901px) and (max-height:700px){
 .auth-header{padding-top:12px;padding-bottom:12px}
 .auth-content{padding-top:8px;padding-bottom:8px}
 .auth-card{padding-top:18px;padding-bottom:16px}
 .auth-card h2{font-size:24px;line-height:30px}
 .auth-card .auth-tabs{height:36px;margin:10px 0}
 .auth-card .auth-field{margin-bottom:6px}
 .auth-input{height:40px}
 .auth-card .auth-options{margin:10px 0}
 .auth-card .auth-switch{margin-top:12px;padding-top:12px}
 .auth-card .auth-security{margin-top:12px}
 .auth-footer{padding-top:12px;padding-bottom:12px}
}
</style>
