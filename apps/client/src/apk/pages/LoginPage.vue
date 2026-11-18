<script setup lang="ts">
import { Headphones, UserRound, LockKeyhole, Eye, EyeOff, LoaderCircle } from 'lucide-vue-next';
import { useAccountAuth } from '../../features/useAccountAuth';
const { app,name,password,confirmation,register,showPassword,showConfirmation,remember,rememberAvailable,starting,confirmInput,changeRemember,submit }=useAccountAuth();
</script>
<template>
 <main class="apk-login">
  <header class="apk-login-brand"><Headphones :size="40" /><h1>同频 TONE</h1><p>每一次相遇，都有共同的旋律</p></header>
  <form class="apk-card apk-login-form" aria-label="APK 账号登录与注册" @submit.prevent="submit">
   <div class="apk-segments" aria-label="认证方式"><button type="button" :aria-pressed="!register" :disabled="starting||app.busy" @click="register=false">登录</button><button type="button" :aria-pressed="register" :disabled="starting||app.busy" @click="register=true">注册</button></div>
   <h2>{{ register?'创建同频账号':'欢迎回到同频' }}</h2>
   <label>用户名<span class="apk-input"><UserRound :size="20" /><input v-model="name" required minlength="2" maxlength="40" autocomplete="username" placeholder="请输入用户名" :disabled="starting||app.busy" /></span></label>
   <label>密码<span class="apk-input"><LockKeyhole :size="20" /><input v-model="password" required minlength="10" maxlength="128" :autocomplete="register?'new-password':'current-password'" :type="showPassword?'text':'password'" placeholder="10–128 位密码" :disabled="starting||app.busy" /><button type="button" class="icon-button" :aria-label="showPassword?'隐藏密码':'显示密码'" @click="showPassword=!showPassword"><EyeOff v-if="showPassword" :size="20" /><Eye v-else :size="20" /></button></span></label>
   <label v-if="register">确认密码<span class="apk-input"><LockKeyhole :size="20" /><input ref="confirmInput" v-model="confirmation" required minlength="10" maxlength="128" autocomplete="new-password" :type="showConfirmation?'text':'password'" placeholder="再次输入密码" :disabled="starting||app.busy" /><button type="button" class="icon-button" :aria-label="showConfirmation?'隐藏确认密码':'显示确认密码'" @click="showConfirmation=!showConfirmation"><EyeOff v-if="showConfirmation" :size="20" /><Eye v-else :size="20" /></button></span></label>
   <label class="apk-remember"><input v-model="remember" type="checkbox" :disabled="!rememberAvailable||starting||app.busy" @change="changeRemember" /><span>记住密码，下次自动登录</span></label>
   <p v-if="app.notice" class="apk-message" role="alert">{{ app.notice }}</p>
   <button class="primary full" :disabled="starting||app.busy" :aria-busy="starting||app.busy"><LoaderCircle v-if="starting||app.busy" :size="18" class="spinning" />{{ starting||app.busy?'连接中…':register?'注册并登录':'登录，找到你的同频' }}</button>
   <p class="apk-hint">{{ rememberAvailable?'仅在个人设备启用；系统加密保存，退出登录或取消勾选会清除。':'当前环境未启用应用安全存储，请手动登录；浏览器可使用系统密码管理器。' }}找回密码请联系管理员。</p>
  </form>
 </main>
</template>
