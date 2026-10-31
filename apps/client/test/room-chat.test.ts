import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { all, node, renderer, text } from './helpers/vue-host';
import RoomChat from '../src/components/RoomChat.vue';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';

const fixture = vi.hoisted(() => ({ app: null as any }));
vi.mock('../src/store', () => ({ useApp: () => fixture.app }));
vi.mock('../src/bridge', () => ({ sendChat: vi.fn() }));
let mounted: ReturnType<typeof renderer.createApp>;
const settle = async () => { await nextTick(); await nextTick(); };
beforeEach(() => {
  fixture.app = reactive({ user: { id: 'me' }, room: { id: 'room', members: [] }, connected: true, chatMessages: [] });
});
afterEach(() => mounted?.unmount());
async function mount() {
  const root = node('root'); mounted = renderer.createApp(RoomChat); mounted.mount(root); await settle(); return root;
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
