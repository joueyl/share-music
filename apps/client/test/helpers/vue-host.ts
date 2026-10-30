import { vi } from 'vitest';
import { createRenderer } from 'vue';
export function node(type: string, text = ''): any { return { type, text, tagName: type.toUpperCase(), value: '', checked: false, getRootNode: () => ({}), addEventListener: vi.fn(), removeEventListener: vi.fn(), props: {}, children: [], parent: null, setCustomValidity: vi.fn(), reportValidity: vi.fn() }; }
export const renderer = createRenderer<any, any>({
 createElement: tag => node(tag), createText: text => node('text', text), createComment: text => node('comment', text),
 setText: (n, text) => { n.text = text; }, setElementText: (n, text) => { n.text = text; n.children = []; },
 patchProp: (n, key, _, value) => { n.props[key] = value; }, parentNode: n => n.parent,
 nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
 insert(n, parent, anchor) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, n); },
 remove(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); },
});
export const all = (n: any): any[] => [n, ...n.children.flatMap(all)];
export const text = (n: any): string => n.text + n.children.map(text).join('');
