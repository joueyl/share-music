<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as THREE from 'three';
import { createStageViewport, STAGE_RENDERER_OPTIONS } from '../stage-viewport';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RotateCcw } from 'lucide-vue-next';
import { useApp } from '../store';
import { stageTheme } from '../stage-theme';
import type { Track } from '@music-share/shared';

const props = defineProps<{
  track?: Track;
  coverUrl?: string;
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const app = useApp();

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let ipodGroup: THREE.Group;
let frontCaseMesh: THREE.Mesh | null = null;
let clickWheelMesh: THREE.Mesh | null = null;
let centerButtonMesh: THREE.Mesh | null = null;
let screenDisplayMesh: THREE.Mesh | null = null;
let userHasInteracted = false;
const defaultCamPos = new THREE.Vector3(0, 0.01, 2.78);
const defaultLookAt = new THREE.Vector3(0, 0, 0);

const SCREEN_W = 1024;
const SCREEN_H = 680;
let screenCanvas: HTMLCanvasElement;
let screenCtx: CanvasRenderingContext2D;
let screenCanvasTexture: THREE.CanvasTexture;

const WHEEL_SIZE = 2048;
let wheelCanvas: HTMLCanvasElement;
let wheelCtx: CanvasRenderingContext2D;
let wheelCanvasTexture: THREE.CanvasTexture;

let currentCoverImg: HTMLImageElement | null = null;
let animId: number = 0;
let progressTimer: number = 0;

let targetRotX = 0; // 默认 0 垂直端正立起，绝不倾斜
let targetRotY = 0;

function formatTime(ms: number): string {
  if (!ms || ms < 0 || !Number.isFinite(ms)) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let len = text.length;
  while (len > 0 && ctx.measureText(text.slice(0, len) + '…').width > maxWidth) {
    len--;
  }
  return text.slice(0, len) + '…';
}

// 动态绘制 2048x2048 超清晰矢量转轮 (含 MENU, 播放/暂停, 快进快退)
function drawLiveWheel() {
  if (!wheelCtx) return;
  wheelCtx.clearRect(0, 0, WHEEL_SIZE, WHEEL_SIZE);

  const cx = WHEEL_SIZE / 2;
  const cy = WHEEL_SIZE / 2;
  const outerR = WHEEL_SIZE / 2 - 4;

  // 1. 底色
  wheelCtx.fillStyle = stageTheme.ipod.wheelColor;
  wheelCtx.beginPath();
  wheelCtx.arc(cx, cy, outerR, 0, Math.PI * 2);
  wheelCtx.fill();

  // 2. 细腻径向渐变
  const wheelGrad = wheelCtx.createRadialGradient(cx, cy, outerR * 0.35, cx, cy, outerR);
  wheelGrad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
  wheelGrad.addColorStop(0.8, 'rgba(0, 0, 0, 0)');
  wheelGrad.addColorStop(1, 'rgba(0, 0, 0, 0.15)');
  wheelCtx.fillStyle = wheelGrad;
  wheelCtx.beginPath();
  wheelCtx.arc(cx, cy, outerR, 0, Math.PI * 2);
  wheelCtx.fill();

  // 3. 矢量文字与符号颜色自适应
  const hex = stageTheme.ipod.wheelColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  const iconColor = luminance > 160 ? 'rgba(30, 32, 36, 0.85)' : 'rgba(255, 255, 255, 0.95)';

  wheelCtx.fillStyle = iconColor;

  // MENU
  wheelCtx.font = 'bold 118px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  wheelCtx.textAlign = 'center';
  wheelCtx.textBaseline = 'middle';
  wheelCtx.fillText('MENU', cx, cy - outerR * 0.77);

  // 底部播放/暂停
  const botY = cy + outerR * 0.77;
  const triW = 60, triH = 70;
  const triX = cx - 42;
  wheelCtx.beginPath();
  wheelCtx.moveTo(triX - triW / 2, botY - triH / 2);
  wheelCtx.lineTo(triX + triW / 2, botY);
  wheelCtx.lineTo(triX - triW / 2, botY + triH / 2);
  wheelCtx.closePath();
  wheelCtx.fill();

  const barW = 18, barH = 66, barGap = 16;
  const barStartX = cx + 24;
  wheelCtx.fillRect(barStartX, botY - barH / 2, barW, barH);
  wheelCtx.fillRect(barStartX + barW + barGap, botY - barH / 2, barW, barH);

  // 右侧下一首
  const rightX = cx + outerR * 0.77;
  const rightY = cy;
  const tw = 46, th = 62, tgap = 8;
  wheelCtx.beginPath();
  wheelCtx.moveTo(rightX - tw - tgap, rightY - th / 2);
  wheelCtx.lineTo(rightX - tgap, rightY);
  wheelCtx.lineTo(rightX - tw - tgap, rightY + th / 2);
  wheelCtx.closePath();
  wheelCtx.fill();

  wheelCtx.beginPath();
  wheelCtx.moveTo(rightX, rightY - th / 2);
  wheelCtx.lineTo(rightX + tw, rightY);
  wheelCtx.lineTo(rightX, rightY + th / 2);
  wheelCtx.closePath();
  wheelCtx.fill();
  wheelCtx.fillRect(rightX + tw + tgap, rightY - th / 2, 16, th);

  // 左侧上一首
  const leftX = cx - outerR * 0.77;
  const leftY = cy;
  wheelCtx.fillRect(leftX - tw - tgap - 16, leftY - th / 2, 16, th);
  wheelCtx.beginPath();
  wheelCtx.moveTo(leftX, leftY - th / 2);
  wheelCtx.lineTo(leftX - tw, leftY);
  wheelCtx.lineTo(leftX, leftY + th / 2);
  wheelCtx.closePath();
  wheelCtx.fill();

  wheelCtx.beginPath();
  wheelCtx.moveTo(leftX + tw + tgap, leftY - th / 2);
  wheelCtx.lineTo(leftX + tgap, leftY);
  wheelCtx.lineTo(leftX + tw + tgap, leftY + th / 2);
  wheelCtx.closePath();
  wheelCtx.fill();

  if (wheelCanvasTexture) {
    wheelCanvasTexture.needsUpdate = true;
  }
}

// 动态绘制 1024x680 标准视网膜活体屏幕（高对比度，消除超高频缩小模糊）
function drawLiveScreen() {
  if (!screenCtx) return;
  screenCtx.clearRect(0, 0, SCREEN_W, SCREEN_H);

  // 1. 经典拟物底色
  const bgGrad = screenCtx.createLinearGradient(0, 0, 0, SCREEN_H);
  bgGrad.addColorStop(0, '#ffffff');
  bgGrad.addColorStop(1, '#f2f4f7');
  screenCtx.fillStyle = bgGrad;
  screenCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  // 2. 状态栏
  const headerH = 68;
  const headerGrad = screenCtx.createLinearGradient(0, 0, 0, headerH);
  headerGrad.addColorStop(0, '#e5e9ea');
  headerGrad.addColorStop(0.5, '#cdd3d3');
  headerGrad.addColorStop(1, '#bec4c4');
  screenCtx.fillStyle = headerGrad;
  screenCtx.fillRect(0, 0, SCREEN_W, headerH);

  // 状态栏下边线
  screenCtx.fillStyle = '#9aa1a1';
  screenCtx.fillRect(0, headerH - 2, SCREEN_W, 2);

  // 标题: Now Playing（加粗加黑）
  screenCtx.fillStyle = '#111417';
  screenCtx.font = 'bold 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';
  screenCtx.textAlign = 'left';
  screenCtx.textBaseline = 'middle';
  screenCtx.fillText('Now Playing', 40, headerH / 2);

  // 播放 / 暂停 图标
  const isPlaying = app.room?.playback.playState === 'playing';
  const px = 860, py = 20;
  screenCtx.fillStyle = '#007aff';
  if (isPlaying) {
    screenCtx.fillRect(px, py, 9, 28);
    screenCtx.fillRect(px + 15, py, 9, 28);
  } else {
    screenCtx.beginPath();
    screenCtx.moveTo(px, py);
    screenCtx.lineTo(px + 24, py + 14);
    screenCtx.lineTo(px, py + 28);
    screenCtx.closePath();
    screenCtx.fill();
  }

  // 电池图标
  const bx = 910, by = 21, bw = 64, bh = 26;
  screenCtx.strokeStyle = '#5a6264';
  screenCtx.lineWidth = 2.5;
  screenCtx.strokeRect(bx, by, bw, bh);
  screenCtx.fillStyle = '#5a6264';
  screenCtx.fillRect(bx + bw, by + 7, 5, 12);
  screenCtx.fillStyle = '#34c759';
  screenCtx.fillRect(bx + 4, by + 4, 48, bh - 8);

  // 3. 专辑封面（比例放大到 370x370，更加饱满）
  const cx = 48, cy = 94, csize = 370, cr = 8;
  if (currentCoverImg && currentCoverImg.complete && currentCoverImg.naturalWidth > 0) {
    screenCtx.save();
    screenCtx.beginPath();
    screenCtx.roundRect(cx, cy, csize, csize, cr);
    screenCtx.clip();

    const aspect = currentCoverImg.width / currentCoverImg.height;
    let sx = 0, sy = 0, sw = currentCoverImg.width, sh = currentCoverImg.height;
    if (aspect > 1) {
      sw = currentCoverImg.height;
      sx = (currentCoverImg.width - sw) / 2;
    } else {
      sh = currentCoverImg.width;
      sy = (currentCoverImg.height - sh) / 2;
    }
    screenCtx.drawImage(currentCoverImg, sx, sy, sw, sh, cx, cy, csize, csize);
    screenCtx.restore();

    // 封面精致描边
    screenCtx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    screenCtx.lineWidth = 2.5;
    screenCtx.beginPath();
    screenCtx.roundRect(cx, cy, csize, csize, cr);
    screenCtx.stroke();

    // 镜面淡出倒影
    const reflH = 80;
    const reflY = cy + csize + 4;
    screenCtx.save();
    screenCtx.beginPath();
    screenCtx.rect(cx, reflY, csize, reflH);
    screenCtx.clip();
    screenCtx.translate(0, reflY * 2 + reflH);
    screenCtx.scale(1, -1);
    screenCtx.drawImage(currentCoverImg, sx, sy, sw, sh, cx, reflY, csize, csize);
    screenCtx.restore();

    // 覆盖倒影渐变遮罩
    const rGrad = screenCtx.createLinearGradient(0, reflY, 0, reflY + reflH);
    rGrad.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
    rGrad.addColorStop(0.7, 'rgba(247, 248, 250, 0.85)');
    rGrad.addColorStop(1, 'rgba(242, 244, 247, 1.0)');
    screenCtx.fillStyle = rGrad;
    screenCtx.fillRect(cx, reflY, csize, reflH + 4);
  } else {
    screenCtx.fillStyle = '#e2e5e9';
    screenCtx.beginPath();
    screenCtx.roundRect(cx, cy, csize, csize, cr);
    screenCtx.fill();
    screenCtx.fillStyle = '#8e8e93';
    screenCtx.font = '54px sans-serif';
    screenCtx.textAlign = 'center';
    screenCtx.textBaseline = 'middle';
    screenCtx.fillText('🎵', cx + csize / 2, cy + csize / 2);
  }

  // 4. 曲目信息（黄金大字号、浓郁深黑、刀锋般清晰）
  const tx = 455;
  const maxTextW = 525;
  const songTitle = props.track?.name || '等待播放音乐';
  const songArtist = props.track?.artists || '同频音乐共享';
  const songAlbum = props.track?.album || '';

  screenCtx.textAlign = 'left';
  screenCtx.textBaseline = 'alphabetic';

  // 歌曲名：大标题、纯正深黑、坚实笔画
  screenCtx.fillStyle = '#050507';
  screenCtx.font = 'bold 50px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';
  const fitTitle = fitText(screenCtx, songTitle, maxTextW);
  screenCtx.fillText(fitTitle, tx, 180);
  screenCtx.fillText(fitTitle, tx, 180); // 双绘制增加像素密度，防止边缘淡化

  // 歌手名：深黑青清晰大字
  screenCtx.fillStyle = '#1c2430';
  screenCtx.font = 'bold 38px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';
  const fitArtist = fitText(screenCtx, songArtist, maxTextW);
  screenCtx.fillText(fitArtist, tx, 265);
  screenCtx.fillText(fitArtist, tx, 265);

  // 专辑名：清晰对比度中灰字
  if (songAlbum) {
    screenCtx.fillStyle = '#4a5568';
    screenCtx.font = '600 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';
    const fitAlbum = fitText(screenCtx, songAlbum, maxTextW);
    screenCtx.fillText(fitAlbum, tx, 345);
    screenCtx.fillText(fitAlbum, tx, 345);
  }

  // 5. 进度条与播放时长
  const currentMs = app.progress || 0;
  const totalMs = props.track?.durationMs || 240000;
  const playProgress = Math.max(0, Math.min(1, totalMs > 0 ? currentMs / totalMs : 0));
  const remainMs = Math.max(0, totalMs - currentMs);

  const timeY = 565;
  screenCtx.fillStyle = '#1c2430';
  screenCtx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  screenCtx.textAlign = 'left';
  screenCtx.fillText(formatTime(currentMs), 48, timeY);
  screenCtx.textAlign = 'right';
  screenCtx.fillText(`-${formatTime(remainMs)}`, 974, timeY);

  const barX = 155, barY = 544, barW = 705, barH = 28, barR = 7;
  // 进度底槽
  screenCtx.fillStyle = '#dde1e7';
  screenCtx.beginPath();
  screenCtx.roundRect(barX, barY, barW, barH, barR);
  screenCtx.fill();
  screenCtx.strokeStyle = '#bcc2cb';
  screenCtx.lineWidth = 2;
  screenCtx.stroke();

  // 进度填充 (#007aff)
  const fillW = Math.max(barR * 2, barW * playProgress);
  const blueGrad = screenCtx.createLinearGradient(0, barY, 0, barY + barH);
  blueGrad.addColorStop(0, '#40a9ff');
  blueGrad.addColorStop(0.5, '#007aff');
  blueGrad.addColorStop(1, '#005ecb');
  screenCtx.fillStyle = blueGrad;
  screenCtx.beginPath();
  screenCtx.roundRect(barX, barY, fillW, barH, barR);
  screenCtx.fill();

  // 进度条微高光
  screenCtx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  screenCtx.lineWidth = 2.5;
  screenCtx.beginPath();
  screenCtx.moveTo(barX + barR, barY + 5);
  screenCtx.lineTo(barX + fillW - barR, barY + 5);
  screenCtx.stroke();

  if (screenCanvasTexture) {
    screenCanvasTexture.needsUpdate = true;
  }
}

function loadCoverImage(url?: string) {
  if (!url) {
    currentCoverImg = null;
    drawLiveScreen();
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    currentCoverImg = img;
    drawLiveScreen();
  };
  img.onerror = () => {
    currentCoverImg = null;
    drawLiveScreen();
  };
  img.src = url;
}

function updateThemeMaterials() {
  if (frontCaseMesh) {
    (frontCaseMesh.material as THREE.MeshStandardMaterial).color.set(stageTheme.ipod.bodyColor);
    (frontCaseMesh.material as THREE.MeshStandardMaterial).roughness = stageTheme.ipod.roughness;
    (frontCaseMesh.material as THREE.MeshStandardMaterial).metalness = stageTheme.ipod.metalness;
  }
  if (centerButtonMesh) {
    (centerButtonMesh.material as THREE.MeshStandardMaterial).color.set(stageTheme.ipod.buttonColor);
  }
  drawLiveWheel();
}

watch(
  () => [
    stageTheme.ipod.bodyColor,
    stageTheme.ipod.wheelColor,
    stageTheme.ipod.buttonColor,
    stageTheme.ipod.roughness,
    stageTheme.ipod.metalness
  ],
  updateThemeMaterials
);

watch(() => props.coverUrl, (url) => loadCoverImage(url), { immediate: true });
watch(() => [props.track?.id, props.track?.name, app.room?.playback.playState], () => drawLiveScreen());

// 纯展示：未主动自由旋转且开启了视差开关时，支持鼠标平滑微动
function onMouseMove(e: MouseEvent) {
  if (!containerRef.value || !stageTheme.ipod.parallaxTilt || userHasInteracted) {
    targetRotX = 0;
    targetRotY = 0;
    return;
  }
  const rect = containerRef.value.getBoundingClientRect();
  const normX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const normY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  targetRotY = normX * 0.12;
  targetRotX = -normY * 0.08;
}

function onMouseLeave() {
  targetRotX = 0;
  targetRotY = 0;
}

// 复位视角至初始正面黄金比例角度
function resetCameraView() {
  if (!controls || !camera) return;
  userHasInteracted = false;
  targetRotX = 0;
  targetRotY = 0;
  controls.reset();
  camera.position.copy(defaultCamPos);
  controls.target.copy(defaultLookAt);
  camera.lookAt(defaultLookAt);
}

onMounted(() => {
  if (!containerRef.value) return;
  const container = containerRef.value;
  const width = container.clientWidth || 460;
  const height = container.clientHeight || 460;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
  // 相机距离优化为 2.78：保持 iPod 优雅完整呈现，同时放大屏幕显示比例，显著提高屏幕文字物理像素
  camera.position.set(0, 0.01, 2.78);

  renderer = new THREE.WebGLRenderer(STAGE_RENDERER_OPTIONS);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // OrbitControls: 允许用户自由拖拽 360° 全方位把玩、旋转、缩放 iPod 机身
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.2;
  controls.maxDistance = 5.5;
  controls.target.copy(defaultLookAt);
  controls.addEventListener('start', () => {
    userHasInteracted = true;
    targetRotX = 0;
    targetRotY = 0;
  });

  // 摄影棚灯光
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.25);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(-2.5, 4.0, 3.0);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  keyLight.shadow.bias = -0.0001;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xf2f6fa, 1.6);
  fillLight.position.set(3.0, 1.5, 2.5);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 1.8);
  rimLight.position.set(0, -3.0, -2.0);
  scene.add(rimLight);

  // 背部补光（当用户转动查看背面抛光镜面金属和苹果标时呈现精致反光）
  const backLight = new THREE.DirectionalLight(0xffffff, 1.8);
  backLight.position.set(2.0, 2.5, -3.5);
  scene.add(backLight);



  // 创建转轮 Canvas 贴图
  wheelCanvas = document.createElement('canvas');
  wheelCanvas.width = WHEEL_SIZE;
  wheelCanvas.height = WHEEL_SIZE;
  wheelCtx = wheelCanvas.getContext('2d')!;
  wheelCtx.imageSmoothingEnabled = true;
  wheelCtx.imageSmoothingQuality = 'high';
  wheelCanvasTexture = new THREE.CanvasTexture(wheelCanvas);
  wheelCanvasTexture.colorSpace = THREE.SRGBColorSpace;
  wheelCanvasTexture.generateMipmaps = true;
  wheelCanvasTexture.minFilter = THREE.LinearMipmapLinearFilter;
  wheelCanvasTexture.magFilter = THREE.LinearFilter;
  wheelCanvasTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 16);
  wheelCanvasTexture.flipY = false;

  // 创建屏幕 Canvas 贴图
  screenCanvas = document.createElement('canvas');
  screenCanvas.width = SCREEN_W;
  screenCanvas.height = SCREEN_H;
  screenCtx = screenCanvas.getContext('2d')!;
  screenCtx.imageSmoothingEnabled = true;
  screenCtx.imageSmoothingQuality = 'high';
  screenCanvasTexture = new THREE.CanvasTexture(screenCanvas);
  screenCanvasTexture.colorSpace = THREE.SRGBColorSpace;
  screenCanvasTexture.generateMipmaps = true;
  screenCanvasTexture.minFilter = THREE.LinearMipmapLinearFilter;
  screenCanvasTexture.magFilter = THREE.LinearFilter;
  screenCanvasTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 16);
  screenCanvasTexture.flipY = false;

  drawLiveWheel();
  drawLiveScreen();

  // iPod 容器组
  ipodGroup = new THREE.Group();
  scene.add(ipodGroup);

  // 加载 3D 模型
  const loader = new GLTFLoader();
  loader.load('/ipod_model.glb', (gltf: any) => {
    const model = gltf.scene;
    // 正面立起面朝镜头
    model.rotation.x = Math.PI / 2;
    ipodGroup.add(model);

    model.traverse((child: any) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (mesh.material) mesh.material = (mesh.material as THREE.Material).clone();

        const name = child.name;
        if (name.includes('Front')) {
          frontCaseMesh = mesh;
          mesh.material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(stageTheme.ipod.bodyColor),
            roughness: stageTheme.ipod.roughness,
            metalness: stageTheme.ipod.metalness
          });
        } else if (name.includes('Back')) {
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0xe0e2e5,
            metalness: 0.98,
            roughness: 0.12
          });
        } else if (name.includes('Wheel')) {
          clickWheelMesh = mesh;
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: wheelCanvasTexture,
            roughness: 0.35,
            metalness: 0.05
          });
        } else if (name.includes('Center')) {
          centerButtonMesh = mesh;
          mesh.material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(stageTheme.ipod.buttonColor),
            roughness: 0.38,
            metalness: 0.05
          });
        } else if (name.includes('Screen_Display') || name.includes('Plane')) {
          screenDisplayMesh = mesh;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          mesh.material = new THREE.MeshBasicMaterial({
            map: screenCanvasTexture
          });
        } else if (name.includes('Glass')) {
          // 隐藏模糊的覆盖玻璃罩，消除漫反射白雾遮挡，确保屏幕文字如同 Retina 屏般纯净锐利
          mesh.visible = false;
        }
      }
    });

    updateThemeMaterials();
  });

  const viewport = createStageViewport(renderer, container, (w, h) => {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  // 渲染循环
  const clock = new THREE.Clock();

  function animate() {
    animId = requestAnimationFrame(animate);
    viewport.sync();
    const elapsedTime = clock.getElapsedTime();

    if (ipodGroup) {
      const isPlaying = app.room?.playback.playState === 'playing';

      if (isPlaying && stageTheme.ipod.beatPulse && !userHasInteracted) {
        // 音乐轻微律动：舒缓自然的微呼吸动效（用户拖拽查看时不干扰视角）
        const tempo = elapsedTime * 2.2;
        const beatRoll = Math.sin(tempo) * 0.022;
        const beatYaw = Math.cos(tempo) * 0.015;
        const beatPitch = Math.sin(tempo * 2) * 0.012;
        const beatPosY = Math.abs(Math.sin(tempo)) * 0.008;

        const curRotY = stageTheme.ipod.parallaxTilt ? targetRotY : 0;
        const curRotX = stageTheme.ipod.parallaxTilt ? targetRotX : 0;

        ipodGroup.rotation.z += (beatRoll - ipodGroup.rotation.z) * 0.08;
        ipodGroup.rotation.y += (curRotY + beatYaw - ipodGroup.rotation.y) * 0.08;
        ipodGroup.rotation.x += (curRotX + beatPitch - ipodGroup.rotation.x) * 0.08;

        ipodGroup.position.x += (0 - ipodGroup.position.x) * 0.08;
        ipodGroup.position.y += (beatPosY - ipodGroup.position.y) * 0.08;
        ipodGroup.scale.set(1, 1, 1);
      } else {
        // 暂停、关闭律动、或用户自由拖拽把玩时：平稳保持端正，只响应视差（如开启）
        const curRotY = (!userHasInteracted && stageTheme.ipod.parallaxTilt) ? targetRotY : 0;
        const curRotX = (!userHasInteracted && stageTheme.ipod.parallaxTilt) ? targetRotX : 0;

        ipodGroup.rotation.z += (0 - ipodGroup.rotation.z) * 0.08;
        ipodGroup.rotation.y += (curRotY - ipodGroup.rotation.y) * 0.08;
        ipodGroup.rotation.x += (curRotX - ipodGroup.rotation.x) * 0.08;
        ipodGroup.position.x += (0 - ipodGroup.position.x) * 0.08;
        ipodGroup.position.y += (0 - ipodGroup.position.y) * 0.08;
        ipodGroup.scale.set(1, 1, 1);
      }
    }

    if (controls) {
      controls.update();
    }

    renderer.render(scene, camera);
  }

  animate();

  progressTimer = window.setInterval(() => {
    if (app.room?.playback.playState === 'playing') {
      drawLiveScreen();
    }
  }, 250);

  onUnmounted(() => {
    cancelAnimationFrame(animId);
    clearInterval(progressTimer);
    viewport.dispose();
    if (controls) {
      controls.dispose();
    }
    if (renderer.domElement.parentElement) {
      renderer.domElement.parentElement.removeChild(renderer.domElement);
    }
    renderer.dispose();
  });
});
</script>

<template>
  <div
    ref="containerRef"
    class="ipod-3d-stage"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeave"
  >
    <!-- 复位视角按钮 -->
    <button
      type="button"
      class="reset-view-pill"
      title="点击复位 3D 视角"
      @click="resetCameraView"
    >
      <RotateCcw :size="11" />
      <span>复位视角</span>
    </button>
  </div>
</template>

<style scoped>
.ipod-3d-stage {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: grab;
  user-select: none;
  display: flex;
  justify-content: center;
  align-items: center;
}

.ipod-3d-stage:active {
  cursor: grabbing;
}

:deep(canvas) { display: block; width: 100%; height: 100%; }

.reset-view-pill {
  position: absolute;
  bottom: 12px;
  right: 14px;
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 14px;
  padding: 4px 10px;
  font-size: 10.5px;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition: all 0.2s ease;
  z-index: 5;
  opacity: 0.6;
}

.reset-view-pill:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.95);
  color: #10b981;
}
</style>
