import { onMounted,ref,watch } from 'vue';
import { useApp } from '../store';
import { canRememberLogin,clearSavedLogin } from '../saved-login';
export function useAccountAuth(){
const app=useApp();
const name = ref(''), password = ref(''), confirmation = ref(''), register = ref(false);
const showPassword = ref(false), showConfirmation = ref(false);
const remember = ref(false), rememberAvailable = ref(false), starting = ref(true);
const confirmInput = ref<HTMLInputElement | null>(null);
watch(register, () => { password.value = ''; confirmation.value = ''; showPassword.value = false; showConfirmation.value = false; });
watch([password, confirmation], () => confirmInput.value?.setCustomValidity(''));

onMounted(async()=>{
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

return { app,name,password,confirmation,register,showPassword,showConfirmation,remember,rememberAvailable,starting,confirmInput,changeRemember,submit };
}
