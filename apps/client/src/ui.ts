import { reactive } from 'vue';
/** View-only state. Room and playback truth always come from the server store. */
export const ui = reactive({ search: false, library: false, queue: false, settings: false, members: false, theme: false, roomKeywords: '' });
export function resetUi() { ui.search = ui.library = ui.queue = ui.settings = ui.members = ui.theme = false; ui.roomKeywords = ''; }
export function openSearch() { ui.queue = ui.members = ui.settings = ui.theme = false; ui.search = true; }
