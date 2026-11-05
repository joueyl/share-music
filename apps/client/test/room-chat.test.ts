import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { h, nextTick, reactive, ref } from 'vue';
import { sendChat } from '../src/bridge';
import { all, node, renderer, text } from './helpers/vue-host';
import RoomChat from '../src/components/RoomChat.vue';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';

const fixture = vi.hoisted(() => ({ app: null as any, modalOpen: false }));
vi.mock('../src/useDialogFocus', () => ({ modalDepth: { get value() { return fixture.modalOpen ? 1 : 0; } } }));
vi.mock('../src/store', () => ({ useApp: () => fixture.app }));
vi.mock('../src/bridge', () => ({ sendChat: vi.fn() }));
let mounted: ReturnType<typeof renderer.createApp>;
const chatActive = ref(true);
const settle = async () => { await nextTick(); await nextTick(); };
beforeEach(() => {
  vi.stubGlobal('Document', class {}); vi.stubGlobal('ShadowRoot', class {});
  vi.mocked(sendChat).mockReset(); fixture.modalOpen = false; chatActive.value = true;
  fixture.app = reactive({ user: { id: 'me' }, room: { id: 'room', members: [] }, connected: true, chatMessages: [] });
});
afterEach(() => { mounted?.unmount(); vi.unstubAllGlobals(); });
async function mount() {
  const root = node('root'); mounted = renderer.createApp({ render: () => h(RoomChat, { active: chatActive.value }) }); mounted.mount(root); await settle(); return root;
}
const message = (id: string, kind?: 'activity') => ({ id, requestId: id, roomId: 'room', userId: 'me', userName: '<小明>', sentAt: 100000, text: '点播了《晚风》', kind });

it('styles only the chat scrollbar with a stable gutter and rounded WebView2 thumb', () => {
  const {descriptor}=parse(readFileSync(new URL('../src/components/RoomChat.vue',import.meta.url),'utf8'));
  const style=descriptor.styles.find(s=>s.scoped)!;
  expect(style).toBeDefined();
  expect(style.content).toContain('scrollbar-gutter:stable');
  expect(style.content).toContain('.room-chat-messages::-webkit-scrollbar{width:8px;height:8px}');
  expect(style.content).toContain('border-radius:999px');
  expect(style.content).toContain('min-height:32px');
  expect(style.content).toContain('::-webkit-scrollbar-thumb:hover');
  expect(style.content).toContain('::-webkit-scrollbar-thumb:active');
  expect(style.content).toContain('forced-colors:active');
  expect(style.content).toContain('.chat-message-bubble{width:fit-content;max-width:100%;padding:7px 10px;line-height:1.55;');
  expect(style.content).toContain('.chat-message{margin-bottom:12px}');
  expect(style.content).toContain('.chat-message-meta{margin-bottom:4px}');
  for(const block of style.content.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
    if(block[1].includes('.room-chat-messages'))expect(block[2]).not.toMatch(/overflow(?:-y)?\s*:\s*(?:hidden|clip)|scrollbar-width\s*:\s*none/);
  }
});

it('renders operations as distinct text-only notices alongside ordinary messages', async () => {
  fixture.app.chatMessages = [message('activity', 'activity'), message('chat')];
  const root = await mount(), articles = all(root).filter(n => n.type === 'article');
  expect(articles.map(n => n.props.class)).toEqual(['chat-activity', 'chat-message own']);
  expect(text(articles[0])).toContain('<小明>（我） 点播了《晚风》');
  expect(all(articles[0]).some(n => 'innerHTML' in n.props)).toBe(false);
  expect(all(articles[0]).some(n => n.type === 'time' && n.props.datetime)).toBe(true);
  expect(all(articles[0]).some(n => n.props.class === 'chat-message-bubble')).toBe(false);
});

it('uses existing unread and scroll-to-bottom behavior for remote operations', async () => {
  const root = await mount(), list = all(root).find(n => n.props.role === 'log');
  Object.assign(list, { scrollHeight: 1000, scrollTop: 0, clientHeight: 200 }); list.props.onScroll();
  fixture.app.chatMessages.push({ ...message('activity', 'activity'), userId: 'other' }); await settle();
  const unread = all(root).find(n => n.props.class === 'chat-unread text-button');
  expect(unread).toBeTruthy(); await unread.props.onClick(); await settle();
  expect(list.scrollTop).toBe(1000);
  expect(all(root).some(n => n.props.class === 'chat-unread text-button')).toBe(false);
});

it.each(['button', 'enter'])('focuses the enabled input after confirmed %s sends, ready for the next message', async mode => {
  let confirm!: () => void;
  vi.mocked(sendChat).mockImplementation(() => new Promise<void>(resolve => { confirm = resolve; }));
  const root = await mount(), input = all(root).find(n => n.type === 'textarea');
  input.focus = vi.fn(() => expect(input.props.disabled).toBe(false));
  input.props['onUpdate:modelValue']('你好'); await settle();
  const form = all(root).find(n => n.type === 'form');
  const event = { key: 'Enter', shiftKey: false, isComposing: false, preventDefault: vi.fn() };
  if (mode === 'enter') input.props.onKeydown(event);
  else form.props.onSubmit({ preventDefault: vi.fn() });
  await settle(); expect(input.props.disabled).toBe(true); expect(input.focus).not.toHaveBeenCalled();
  expect(sendChat).toHaveBeenCalledWith('room', '你好', expect.any(String));
  confirm(); await settle(); await settle();
  expect(input.value).toBe(''); expect(input.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
});

it.each(['failed', 'room', 'left', 'unmounted', 'hidden', 'disconnected', 'modal'])('does not steal focus when a send becomes %s', async mode => {
  let confirm!: () => void, reject!: (error: Error) => void;
  vi.mocked(sendChat).mockImplementation(() => new Promise<void>((resolve, fail) => { confirm = resolve; reject = fail; }));
  const root = await mount(), input = all(root).find(n => n.type === 'textarea'); input.focus = vi.fn();
  input.props['onUpdate:modelValue']('保留草稿'); await settle();
  const pending = all(root).find(n => n.type === 'form').props.onSubmit({ preventDefault: vi.fn() });
  await settle();
  if (mode === 'room') fixture.app.room = { id: 'other', members: [] };
  if (mode === 'left') fixture.app.room = null;
  if (mode === 'unmounted') mounted.unmount();
  if (mode === 'hidden') chatActive.value = false;
  if (mode === 'disconnected') fixture.app.connected = false;
  if (mode === 'modal') fixture.modalOpen = true;
  await settle();
  if (mode === 'failed') reject(new Error('RATE_LIMITED')); else confirm();
  await pending; await settle();
  expect(input.focus).not.toHaveBeenCalled();
  if (mode === 'failed') { expect(input.value).toBe('保留草稿'); expect(text(root)).toContain('发送太快了'); }
});

it('does not send or refocus during IME composition or Shift+Enter', async () => {
  const root = await mount(), input = all(root).find(n => n.type === 'textarea'); input.focus = vi.fn();
  input.props['onUpdate:modelValue']('正在输入'); await settle();
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }]) {
    const event = { key: 'Enter', shiftKey: false, isComposing: false, preventDefault: vi.fn(), ...extra };
    input.props.onKeydown(event); expect(event.preventDefault).not.toHaveBeenCalled();
  }
  expect(sendChat).not.toHaveBeenCalled(); expect(input.focus).not.toHaveBeenCalled();
});
