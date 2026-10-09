import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from './App.vue';
import Lobby from './views/Lobby.vue';
import Room from './views/Room.vue';
import './style.css';
const router = createRouter({ history: createWebHashHistory(), routes: [{ path: '/', component: Lobby }, { path: '/room/:id', component: Room }] });
createApp(App).use(createPinia()).use(router).mount('#app');
