import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { renderer, node, all, text } from './helpers/vue-host';
import AuthPage from '../src/components/AuthPage.vue';
const fixture = vi.hoisted(() => ({ app: null as any, remember: vi.fn(), clear: vi.fn(), route: vi.fn() }));
vi.mock('../src/store', () => ({ useApp: () => fixture.app }));
vi.mock('../src/saved-login', () => ({ canRememberLogin: fixture.remember, clearSavedLogin: fixture.clear }));
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: fixture.route }) }));
const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } };
let mounted: ReturnType<typeof renderer.createApp> | undefined;
async function mount() { const root = node('root'); mounted = renderer.createApp(AuthPage); mounted.mount(root); await settle(); return root; }
const button = (root: any, label: string) => all(root).find(n => n.type === 'button' && text(n) === label);
const field = (root: any, placeholder: string) => all(root).find(n => n.type === 'input' && n.props.placeholder === placeholder);
beforeEach(() => {
 vi.stubGlobal('Document', class {}); vi.stubGlobal('ShadowRoot', class {});
 fixture.remember.mockReset().mockResolvedValue(false); fixture.clear.mockReset();
 fixture.app = reactive({ user: null, busy: false, notice: '', initialize: vi.fn().mockResolvedValue(undefined), restoreLogin: vi.fn().mockResolvedValue(null), login: vi.fn().mockResolvedValue(undefined), error: vi.fn() });
});
afterEach(() => { mounted?.unmount(); vi.unstubAllGlobals(); });
it('renders the Brilliant login composition, real form and exported turntable', async () => {
 const root = await mount(); expect(text(root)).toContain('有人和你，听见同一秒。'); expect(text(root)).toContain('欢迎回到同频');
 expect(all(root).find(n => n.type === 'img').props.src).toContain('login-turntable.svg');
 expect(button(root, '登录，一起听')).toBeTruthy(); expect(field(root, '请输入密码').props.minlength).toBe('10');
 const checkbox = all(root).find(n => n.type === 'input' && n.props.type === 'checkbox'); expect(checkbox.props.disabled).toBe(true);
});
it('toggles password visibility without changing credentials and explains unsupported recovery', async () => {
 const root = await mount(); const input = field(root, '请输入密码'); input.props['onUpdate:modelValue']('password-123');
 all(root).find(n => n.props['aria-label'] === '显示密码').props.onClick(); await settle();
 expect(input.props.type).toBe('text'); expect(input.value).toBe('password-123');
 button(root, '忘记密码').props.onClick(); expect(fixture.app.notice).toContain('暂不支持');
});
it('validates confirmation locally, then sends the existing username/password API contract', async () => {
 const root = await mount(); button(root, '注册').props.onClick(); await settle();
 expect(text(root)).toContain('注册，遇见同频的人');
 field(root, '请输入用户名').props['onUpdate:modelValue']('listener'); field(root, '10–128 位密码').props['onUpdate:modelValue']('password-123');
 const confirm = field(root, '请再次输入密码'); confirm.props['onUpdate:modelValue']('different-123'); await settle();
 const form = all(root).find(n => n.type === 'form'); await form.props.onSubmit({ preventDefault() {} });
 expect(fixture.app.login).not.toHaveBeenCalled(); expect(confirm.reportValidity).toHaveBeenCalled();
 confirm.props['onUpdate:modelValue']('password-123'); await settle(); await form.props.onSubmit({ preventDefault() {} });
 expect(fixture.app.login).toHaveBeenCalledWith('listener', 'password-123', true, false);
});
it('restores only supported saved credentials and clears storage when remember is disabled', async () => {
 fixture.remember.mockResolvedValue(true); fixture.app.restoreLogin.mockResolvedValue({name:'saved-user'});
 const root = await mount(); expect(field(root, '请输入用户名').value).toBe('saved-user');
 const checkbox=all(root).find(n => n.type === 'input' && n.props.type === 'checkbox');
 checkbox.props['onUpdate:modelValue'](false); await checkbox.props.onChange(); expect(fixture.clear).toHaveBeenCalledOnce();
});
