<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { UserRound, LockKeyhole, Eye, EyeOff, LoaderCircle, Minus, Square, X } from 'lucide-vue-next';
import * as bridge from '../bridge';
import { useApp } from '../store';
import { canRememberLogin, clearSavedLogin } from '../saved-login';
import BrandMark from './BrandMark.vue';
import appLogo from '../assets/logo.webp';
const emit = defineEmits<{ version: [] }>();
const app = useApp(), router = useRouter();
const name = ref(''), password = ref(''), confirmation = ref(''), register = ref(false);
const showPassword = ref(false), showConfirmation = ref(false);
const remember = ref(false), rememberAvailable = ref(false), starting = ref(true);
const confirmInput = ref<HTMLInputElement | null>(null);
const isMaximized = ref(false);

watch(register, () => { password.value = ''; confirmation.value = ''; showPassword.value = false; showConfirmation.value = false; });
watch([password, confirmation], () => confirmInput.value?.setCustomValidity(''));

watch(isMaximized, (val) => {
  if (val) {
    document.getElementById('app')?.classList.add('is-maximized');
  } else {
    document.getElementById('app')?.classList.remove('is-maximized');
  }
}, { immediate: true });

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

  if (bridge.desktop) {
    isMaximized.value = await bridge.isWindowMaximized();
    await bridge.onWindowResized(async () => {
      isMaximized.value = await bridge.isWindowMaximized();
    });
  }
});

async function toggleMaximize() {
  await bridge.windowToggleMaximize();
  if (bridge.desktop) {
    isMaximized.value = await bridge.isWindowMaximized();
  }
}

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

function onHeaderMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;
  if (e.detail > 1) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const target = e.target as HTMLElement | null;
  if (target && target.closest('button, a, input, textarea, select, [role="button"], .window-controls')) return;
  void bridge.startDragging();
}

</script>
<template>
  <div class="auth-page" :class="{ 'is-maximized': isMaximized }">
    <header class="auth-header" @mousedown="onHeaderMouseDown" @dblclick.stop.prevent="">
      <!-- <div class="auth-brand" aria-label="同频"><img class="auth-brand-logo-img" :src="appLogo" alt="同频 Logo" /><strong>同频</strong><small>T O N E</small></div> -->
       <div></div>
      <div v-if="bridge.desktop" class="window-controls">
        <button type="button" class="win-btn win-min" title="最小化" @click.stop="bridge.windowMinimize">
          <Minus :size="13" />
        </button>
        <button type="button" class="win-btn win-max" title="最大化 / 还原" @click.stop="toggleMaximize">
          <Square :size="12" />
        </button>
        <button type="button" class="win-btn win-close" title="关闭" @click.stop="bridge.windowClose">
          <X :size="14" />
        </button>
      </div>
    </header>
    <div class="auth-content">
      <section class="auth-intro" aria-label="同频音乐陪伴">
        <div class="auth-brand-visual">
          <div class="auth-ripples" aria-hidden="true"><i></i><i></i><i></i></div>
          <BrandMark class="auth-logo-art" />
        </div>
        <div class="auth-brand-word">
          <h1>同频・TONE</h1>
          <p>在这里 我们一起听</p>
        </div>
      </section>
      <form class="auth-card" :class="{ 'auth-register': register }" aria-label="账号登录与注册" @submit.prevent="submit">
        <h2>{{ register ? '注册，遇见同频的人' : '欢迎回到同频' }}</h2>
        <label class="auth-field">用户名<span class="auth-input"><UserRound :size="18" /><input v-model="name" :disabled="starting || app.busy" autocomplete="username" minlength="2" maxlength="40" required placeholder="请输入用户名" /></span></label>
        <label class="auth-field">{{ register ? '设置密码' : '密码' }}<span class="auth-input"><LockKeyhole :size="18" /><input v-model="password" :disabled="starting || app.busy" :type="showPassword ? 'text' : 'password'" :autocomplete="register ? 'new-password' : 'current-password'" minlength="10" maxlength="128" required :placeholder="register ? '10–128 位密码' : '请输入密码'" /><button type="button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" :disabled="starting || app.busy" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="18" /><Eye v-else :size="18" /></button></span></label>
        <label v-if="register" class="auth-field">确认密码<span class="auth-input"><LockKeyhole :size="18" /><input ref="confirmInput" v-model="confirmation" :disabled="starting || app.busy" :type="showConfirmation ? 'text' : 'password'" autocomplete="new-password" minlength="10" maxlength="128" required placeholder="请再次输入密码" /><button type="button" :aria-label="showConfirmation ? '隐藏确认密码' : '显示确认密码'" :disabled="starting || app.busy" @click="showConfirmation = !showConfirmation"><EyeOff v-if="showConfirmation" :size="18" /><Eye v-else :size="18" /></button></span></label>
        <div class="auth-options">
          <label class="auth-remember" :class="{ disabled: !rememberAvailable || starting || app.busy }" :title="rememberAvailable ? '仅在个人设备启用；凭据由系统安全保存，退出登录会清除' : '当前环境不支持安全保存登录凭据'">
            <input v-model="remember" type="checkbox" :disabled="!rememberAvailable || starting || app.busy" @change="changeRemember" />
            <span class="auth-checkbox-box" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span>记住登录状态</span>
          </label>
          <button v-if="!register" type="button" class="auth-forgot" @click="app.notice = '当前服务端暂不支持自助找回密码，请联系管理员'">忘记密码</button>
          <span v-else class="auth-password-hint">密码为 10–128 位</span>
        </div>
        <button class="auth-submit" :disabled="starting || app.busy" :aria-busy="starting || app.busy"><LoaderCircle v-if="starting || app.busy" class="spinning" :size="18" />{{ starting || app.busy ? '连接中…' : register ? '注册并开始听歌' : '登录，一起听' }}</button>
        <div class="auth-switch"><span>{{ register ? '已有账号？' : '还没有账号？' }}</span><button type="button" :disabled="starting || app.busy" @click="register = !register">{{ register ? '返回登录' : '立即注册' }}</button></div>
      </form>
    </div>
  </div>
</template>
<style scoped>
.auth-page{position:relative;max-width:1440px;min-height:100dvh;margin:auto;font-family:"Microsoft YaHei","Segoe UI",sans-serif;color:#283448}
.auth-header{position:absolute;left:48px;right:8px;top:6px;height:40px;display:flex;align-items:center;justify-content:space-between;user-select:none;z-index:10}
.window-controls{display:flex;align-items:center;height:32px;-webkit-app-region:no-drag}
.win-btn{width:32px;height:32px;border:none;background:transparent;color:#48484a;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;cursor:pointer;transition:all 0.15s ease;padding:0;-webkit-app-region:no-drag}
.win-btn:hover{background:rgba(0,0,0,0.06);color:#111}
.win-btn.win-close:hover{background:#e81123;color:#ffffff}
.auth-brand{display:flex;align-items:center;gap:12px;padding:0;background:none}.auth-brand-logo-img{width:40px;height:40px;border-radius:12px;object-fit:contain;box-shadow:0 2px 8px rgba(0,0,0,0.08);flex-shrink:0}.auth-brand-mark{display:grid;place-items:center;width:40px;height:40px;border-radius:13px;background:#5dbb00;color:white}.auth-brand strong{font-size:23px;font-weight:700}.auth-brand small{font-size:10px;color:#798394;margin-left:3px;white-space:nowrap}.auth-back{background:none;font-size:12px;color:#798394;padding:8px 0;gap:9px}
.auth-content{display:grid;grid-template-columns:minmax(0,1fr) 478px;gap:clamp(40px,14.58vw,210px);padding:175px 112px 140px 84px;align-items:start}
.auth-intro{position:relative;width:100%;min-height:644px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(26px,4vh,46px)}.auth-brand-visual{position:relative;display:grid;place-items:center;width:min(430px,86%);aspect-ratio:1/1}.auth-ripples{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}.auth-ripples i{position:absolute;width:74%;aspect-ratio:1;border-radius:50%;border:1.5px solid rgba(93,187,0,.34);animation:auth-ripple 3.6s cubic-bezier(.2,.8,.2,1) infinite}.auth-ripples i:nth-child(2){animation-delay:1.2s}.auth-ripples i:nth-child(3){animation-delay:2.4s}.auth-logo-art{position:relative;width:100%}.auth-brand-word{display:flex;flex-direction:column;align-items:center;gap:11px;text-align:center}.auth-brand-word h1{font-size:clamp(26px,4.8vw,35px);line-height:1.25;font-weight:700;letter-spacing:.06em;color:#283448;margin:0}.auth-brand-word p{font-size:clamp(11px,1.9vw,14px);line-height:1.6;letter-spacing:.22em;color:#798394;margin:0;white-space:nowrap}@keyframes auth-ripple{0%{transform:scale(.42);opacity:0}18%{opacity:.62}100%{transform:scale(1.85);opacity:0}}@media(prefers-reduced-motion:reduce){.auth-ripples i{animation:none;opacity:.32;transform:scale(1)}}
.auth-card{position:relative;width:478px;min-height:624px;padding:34px 41px 20px;background:#fff;border:1px solid #fff;border-radius:26px;box-shadow:0 12px 40px #4e668212}
.auth-card h2{font-size:27px;line-height:36px;font-weight:500;margin:0 0 24px}
.auth-field{display:flex;flex-direction:column;gap:7px;font-size:12px;color:#283448;margin:0 0 19px;line-height:16px}.auth-input{display:flex;align-items:center;gap:14px;height:52px;border:1px solid #dce4ec;border-radius:12px;padding:0 15px;background:white;color:#798394}.auth-input:focus-within{border-color:#5dbb00;box-shadow:0 0 0 3px #5dbb0012}.auth-input>svg{flex-shrink:0}.auth-input input{min-width:0;flex:1;width:100%;height:100%;border:0!important;outline:none!important;background:none;padding:0;color:#283448;font-size:13px;box-shadow:none}.auth-input input::placeholder{color:#929caa}.auth-input button{width:24px;height:32px;flex-shrink:0;padding:0;background:none;color:#929caa}.auth-options{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:24px 0 28px;min-height:20px}
.auth-remember{display:inline-flex;flex-direction:row;align-items:center;flex-wrap:nowrap;gap:8px;margin:0;font-size:12px;color:#606f85;line-height:16px;white-space:nowrap;cursor:pointer;user-select:none;transition:color .15s ease}.auth-remember>span{white-space:nowrap}
.auth-remember:hover:not(.disabled){color:#283448}
.auth-remember input{position:absolute;opacity:0;width:0;height:0;margin:0;pointer-events:none}
.auth-checkbox-box{width:16px;height:16px;border-radius:5px;border:1.5px solid #c8d4df;background:#fff;display:inline-flex;align-items:center;justify-content:center;transition:all .15s ease;flex-shrink:0;box-sizing:border-box;color:#fff}
.auth-checkbox-box svg{width:10px;height:10px;opacity:0;transform:scale(.5);transition:all .15s cubic-bezier(.34,1.56,.64,1)}
.auth-remember:hover:not(.disabled) .auth-checkbox-box{border-color:#5dbb00}
.auth-remember input:focus-visible + .auth-checkbox-box{border-color:#5dbb00;box-shadow:0 0 0 3px #5dbb0022}
.auth-remember input:checked + .auth-checkbox-box{background:#5dbb00;border-color:#5dbb00}
.auth-remember input:checked + .auth-checkbox-box svg{opacity:1;transform:scale(1)}
.auth-remember.disabled{opacity:.5;cursor:not-allowed}
.auth-remember.disabled .auth-checkbox-box{background:#f3f5f7;border-color:#dce4ec}
.auth-forgot{background:none;color:#5dbb00;padding:0;font-size:11px}
.auth-password-hint{font-size:11px;color:#798394}
.auth-submit{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:48px;border-radius:24px;background:#5dbb00;color:white;font-size:13px;font-weight:500}.auth-submit:hover:not(:disabled){background:#52a600}.auth-switch{display:flex;align-items:center;justify-content:center;gap:8px;border-top:1px solid #e6ebef;margin-top:37px;padding-top:24px;color:#798394;font-size:12px;line-height:20px}.auth-switch button{padding:0;background:none;color:#5dbb00;font-size:12px}
.auth-register{margin-top:-22px;min-height:658px}.auth-register .auth-field{margin-bottom:12px}.auth-register .auth-options{margin:16px 0 20px}.auth-register .auth-switch{margin-top:20px;padding-top:16px}

@media(max-width:1250px) and (min-width:901px){.auth-content{padding-left:5.83%;padding-right:7.78%;gap:40px;grid-template-columns:minmax(0,1fr) 430px}.auth-card{width:430px;padding-left:32px;padding-right:32px}.auth-brand-visual{width:min(360px,86%)}.auth-brand-word h1{font-size:30px}.auth-brand-word p{font-size:13px}.auth-header{right:8px}}
@media(max-width:900px){.auth-page{min-height:100dvh}.auth-header{position:relative;inset:auto;padding:24px;height:auto}.auth-content{display:block;padding:50px 24px 100px}.auth-intro{display:none}.auth-card{width:100%;max-width:478px;margin:0 auto;min-height:624px}.auth-register{margin-top:0}}
@media(max-width:480px){.auth-header{padding:20px}.auth-brand{gap:9px}.auth-brand strong{font-size:20px}.auth-brand small{font-size:8px}.auth-back{font-size:11px}.auth-content{padding:28px 16px 96px}.auth-card{min-height:0;padding:28px 24px;border-radius:24px}.auth-card h2{font-size:24px}.auth-input input{font-size:16px}.auth-input button,.auth-forgot,.auth-switch button{min-height:35px}.auth-options{margin:16px 0 24px;gap:8px}.auth-switch{margin-top:28px}.auth-register .auth-options{align-items:flex-start;flex-wrap:wrap}}
@media(min-width:901px) and (max-height:900px){
 .auth-page{display:flex;flex-direction:column}
 .auth-header{position:relative;inset:auto;height:auto;padding:6px 8px 16px 3.33%;flex-shrink:0}
 .auth-content{flex:1;padding:12px 7.78% 16px 5.83%;align-items:center;gap:clamp(32px,8vw,120px)}
 .auth-intro{min-height:0;height:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(18px,3vh,34px)}
 .auth-brand-visual{width:min(380px,74%)}
 .auth-brand-word h1{font-size:clamp(24px,3.6vh,32px);line-height:1.3}
 .auth-card,.auth-register{min-height:0;margin-top:0;padding:24px 32px 20px}

 .auth-field,.auth-register .auth-field{margin-bottom:12px}
 .auth-input{height:44px}
 .auth-options,.auth-register .auth-options{margin:16px 0}
 .auth-switch,.auth-register .auth-switch{margin-top:20px;padding-top:16px}
 
 .auth-register{padding-top:20px;padding-bottom:16px}
 
 .auth-register .auth-field{margin-bottom:8px}
 .auth-register .auth-options{margin:12px 0}
 
}
@media(max-width:900px){
 .auth-page{display:flex;flex-direction:column}
 .auth-content{flex:1;display:grid;grid-template-columns:minmax(0,1fr);gap:0;place-items:center;padding:20px 24px}
 .auth-card{min-height:0}
 
}
@media(max-width:480px){.auth-content{padding:12px 16px 20px}}
@media(min-width:901px) and (max-height:700px){
 .auth-header{padding-top:6px;padding-right:8px;padding-bottom:12px}
 .auth-content{padding-top:8px;padding-bottom:8px}
 .auth-card{padding-top:18px;padding-bottom:16px}
 .auth-card h2{font-size:24px;line-height:30px}
 
 .auth-card .auth-field{margin-bottom:6px}
 .auth-input{height:40px}
 .auth-card .auth-options{margin:10px 0}
 .auth-card .auth-switch{margin-top:12px;padding-top:12px}


}
</style>
