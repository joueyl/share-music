import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHashHistory } from 'vue-router';
import ApkApp from './ApkApp.vue';
import DiscoverPage from './pages/DiscoverPage.vue';
import ListenPage from './pages/ListenPage.vue';
import MusicPage from './pages/MusicPage.vue';
import '../motion.css';
import '../selects.css';
import './apk.css';

// A separate document, router, shell and layout. No desktop App/views/styles.
const router = createRouter({ history: createWebHashHistory(), scrollBehavior: () => ({ top: 0 }), routes: [
  { path: '/', component: DiscoverPage },
  { path: '/room/:id', component: ListenPage },
  { path: '/playlists', component: MusicPage },
  { path: '/:pathMatch(.*)*', redirect: '/' },
] });
createApp(ApkApp).use(createPinia()).use(router).mount('#app');
