<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as THREE from 'three';
import { createStageViewport, STAGE_RENDERER_OPTIONS } from '../stage-viewport';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RotateCcw } from 'lucide-vue-next';
import { useApp } from '../store';
import { stageTheme, TURNTABLE_VINYL_EDITIONS, TURNTABLE_PLINTH_COLORS } from '../stage-theme';
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
let stageGroup: THREE.Group;

// 3D Nodes
let rotatingAssembly: THREE.Object3D | null = null;
let vinylMesh: THREE.Mesh | null = null;
let centerLabelMesh: THREE.Mesh | null = null;
let plinthMesh: THREE.Mesh | null = null;
let armRoot: THREE.Object3D | null = null;

// Tonearm kinematics
// In glTF Y is UP:
// Rest angle: +0.28 rad (swung outward to the right, parked safely on rest post)
// Start angle: 0.00 rad (outer lead-in groove of vinyl record, distance 0.80)
// End angle: -0.35 rad (inner run-out groove near label, distance 0.41)
const ARM_ANGLE_REST = 0.28;
const ARM_ANGLE_START = 0.00;
const ARM_ANGLE_END = -0.35;

let armBaseY = 0.040;
let armCurrentAngle = ARM_ANGLE_REST;
let armTargetAngle = ARM_ANGLE_REST;
let armLiftY = 0.015;
let armCurrentLiftY = 0.015;

// Rotation physics
let currentRotationSpeed = 0;

// Ultra HD Vinyl Label Canvas (2048x2048 for pristine retina crispness)
const LABEL_SIZE = 2048;
let labelCanvas: HTMLCanvasElement;
let labelCtx: CanvasRenderingContext2D;
let labelTexture: THREE.CanvasTexture;
let currentCoverImage: HTMLImageElement | null = null;

let animId: number = 0;

// Default camera framing state for reset
let defaultCamPos = new THREE.Vector3(0, 4.2, 0.85);
let defaultLookAt = new THREE.Vector3(0, 0, 0);
let userHasInteracted = false;

// Draw Ultra HD Dynamic Vinyl Label
function drawDynamicLabel() {
  if (!labelCtx) return;
  const s = LABEL_SIZE;
  const cx = s / 2;
  const cy = s / 2;
  const r = s / 2;

  labelCtx.clearRect(0, 0, s, s);

  // 1. Background circular clipping
  labelCtx.save();
  labelCtx.beginPath();
  labelCtx.arc(cx, cy, r - 6, 0, Math.PI * 2);
  labelCtx.clip();

  if (currentCoverImage && currentCoverImage.complete && currentCoverImage.naturalWidth > 0) {
    // High-quality center-crop to prevent stretching
    const imgW = currentCoverImage.naturalWidth;
    const imgH = currentCoverImage.naturalHeight;
    const minDim = Math.min(imgW, imgH);
    const sx = (imgW - minDim) / 2;
    const sy = (imgH - minDim) / 2;

    labelCtx.drawImage(currentCoverImage, sx, sy, minDim, minDim, 0, 0, s, s);
  } else {
    // Elegant warm off-white gradient fallback
    const bgGrad = labelCtx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
    bgGrad.addColorStop(0, '#fefefe');
    bgGrad.addColorStop(1, '#e8edea');
    labelCtx.fillStyle = bgGrad;
    labelCtx.fillRect(0, 0, s, s);

    labelCtx.fillStyle = '#1e293b';
    labelCtx.font = 'bold 104px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    labelCtx.textAlign = 'center';
    labelCtx.textBaseline = 'middle';
    const title = props.track?.name || 'QQ音乐 · 留声机';
    labelCtx.fillText(title.slice(0, 16), cx, cy - 70);

    labelCtx.fillStyle = '#64748b';
    labelCtx.font = '58px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const artist = props.track?.artists || '同频共听 · 经典黑胶';
    labelCtx.fillText(artist.slice(0, 20), cx, cy + 60);
  }
  labelCtx.restore();

  // 2. High-resolution outer sage/dark green ring border (classic QQ Music aesthetic)
  labelCtx.save();
  const ringWidth = 52;
  labelCtx.lineWidth = ringWidth;
  labelCtx.strokeStyle = '#56675D';
  labelCtx.beginPath();
  labelCtx.arc(cx, cy, r - ringWidth / 2 - 4, 0, Math.PI * 2);
  labelCtx.stroke();

  // Fine inner metallic accent ring
  labelCtx.lineWidth = 5;
  labelCtx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  labelCtx.beginPath();
  labelCtx.arc(cx, cy, r - ringWidth - 4, 0, Math.PI * 2);
  labelCtx.stroke();

  // 3. Center Spindle Chrome Pin Ring
  labelCtx.fillStyle = 'rgba(235, 240, 238, 0.98)';
  labelCtx.beginPath();
  labelCtx.arc(cx, cy, 64, 0, Math.PI * 2);
  labelCtx.fill();
  labelCtx.lineWidth = 6;
  labelCtx.strokeStyle = '#8d9992';
  labelCtx.stroke();

  labelCtx.restore();

  if (labelTexture) {
    labelTexture.needsUpdate = true;
  }
}

// Convert low-res thumbnail URLs (e.g. 130y130) to Ultra HD (1024y1024)
function upgradeToHdCoverUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  try {
    // If it's a NetEase music CDN image with ?param=...
    if (rawUrl.includes('music.126.net') || rawUrl.includes('music.163.com')) {
      const baseUrl = rawUrl.split('?')[0];
      return `${baseUrl}?param=1024y1024`;
    }
  } catch (e) {
    // fallback to original
  }
  return rawUrl;
}

function loadAlbumCover(url?: string) {
  if (!url) {
    currentCoverImage = null;
    drawDynamicLabel();
    return;
  }

  const hdUrl = upgradeToHdCoverUrl(url);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    currentCoverImage = img;
    drawDynamicLabel();
  };
  img.onerror = () => {
    // fallback to original url if HD param failed
    if (hdUrl !== url) {
      const fallbackImg = new Image();
      fallbackImg.crossOrigin = 'anonymous';
      fallbackImg.onload = () => {
        currentCoverImage = fallbackImg;
        drawDynamicLabel();
      };
      fallbackImg.onerror = () => {
        currentCoverImage = null;
        drawDynamicLabel();
      };
      fallbackImg.src = url;
    } else {
      currentCoverImage = null;
      drawDynamicLabel();
    }
  };
  img.src = hdUrl;
}

watch(
  () => props.coverUrl,
  (newUrl) => {
    loadAlbumCover(newUrl);
  },
  { immediate: true }
);

watch(
  () => props.track?.id,
  () => {
    drawDynamicLabel();
  }
);

// Apply Theme Changes
function updateMaterials() {
  const vEdition = TURNTABLE_VINYL_EDITIONS[stageTheme.turntable.vinylEdition] || TURNTABLE_VINYL_EDITIONS.silver;
  if (vinylMesh && vinylMesh.material) {
    const mat = vinylMesh.material as THREE.MeshStandardMaterial;
    mat.color.set(vEdition.color);
    mat.metalness = vEdition.metalness;
    mat.roughness = vEdition.roughness;
    mat.needsUpdate = true;
  }

  const pColor = TURNTABLE_PLINTH_COLORS[stageTheme.turntable.plinthColor] || TURNTABLE_PLINTH_COLORS.white;
  if (plinthMesh && plinthMesh.material) {
    const mat = plinthMesh.material as THREE.MeshStandardMaterial;
    mat.color.set(pColor.color);
    mat.roughness = pColor.roughness;
    mat.needsUpdate = true;
  }
}

watch(
  () => [stageTheme.turntable.vinylEdition, stageTheme.turntable.plinthColor],
  () => {
    updateMaterials();
  }
);

// Responsive Camera Framing: Ensures the turntable is NEVER cut off and has comfortable breathing margins
function updateCameraFraming() {
  if (!containerRef.value || !camera || !renderer) return;
  const w = containerRef.value.clientWidth;
  const h = containerRef.value.clientHeight;
  if (w <= 0 || h <= 0) return;

  const aspect = w / h;
  camera.aspect = aspect;

  // Turntable bounding box is approx 2.05 in X and 1.78 in Z
  // Ensure comfortable margin (padding ~22%)
  const halfSpanX = 1.05 * 1.25;
  const halfSpanZ = 0.90 * 1.25;
  const vFovRad = (camera.fov * Math.PI) / 180;

  const distY = halfSpanZ / Math.tan(vFovRad / 2);
  const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
  const distX = halfSpanX / Math.tan(hFovRad / 2);

  const idealDist = Math.max(4.0, Math.max(distY, distX));

  // Elegant 78 degrees 3D angle from ground
  const angleRad = (78 * Math.PI) / 180;
  const camY = idealDist * Math.sin(angleRad);
  const camZ = idealDist * Math.cos(angleRad);

  defaultCamPos.set(0.0, camY, camZ);
  defaultLookAt.set(0.0, 0.0, 0.0);

  // If user hasn't actively orbited, keep default framing
  if (controls) {
    controls.target.copy(defaultLookAt);
    if (!userHasInteracted) {
      camera.position.copy(defaultCamPos);
      camera.lookAt(defaultLookAt);
    }
  }

  camera.updateProjectionMatrix();
}

// Reset camera view to default position
function resetCameraView() {
  if (!controls || !camera) return;
  userHasInteracted = false;
  controls.reset();
  updateCameraFraming();
}

onMounted(() => {
  const container = containerRef.value;
  if (!container) return;

  const w = container.clientWidth || 520;
  const h = container.clientHeight || 520;

  // Scene (100% transparent, NO artificial fog)
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);

  // Renderer: 100% transparent background to blend seamlessly with room
  renderer = new THREE.WebGLRenderer(STAGE_RENDERER_OPTIONS);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // OrbitControls: Allows user to freely drag, rotate 360°, inspect, and zoom!
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't flip below stage
  controls.minDistance = 2.2;
  controls.maxDistance = 8.5;
  controls.target.set(0, 0, 0);
  controls.addEventListener('start', () => {
    userHasInteracted = true;
  });

  // Studio Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 1.1);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xfffefb, 1.85);
  keyLight.position.set(-2.5, 4.6, 2.8);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  keyLight.shadow.bias = -0.0001;
  keyLight.shadow.radius = 3;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xf0f5fa, 1.15);
  fillLight.position.set(3.0, 2.5, -1.8);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0.95);
  rimLight.position.set(0.1, 2.2, 4.0);
  scene.add(rimLight);

  // Transparent Radial Contact Shadow (Zero hard borders, naturally rests on room stage)
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 512;
  shadowCanvas.height = 512;
  const sCtx = shadowCanvas.getContext('2d')!;
  const sGrad = sCtx.createRadialGradient(256, 256, 50, 256, 256, 240);
  sGrad.addColorStop(0, 'rgba(25, 40, 60, 0.25)');
  sGrad.addColorStop(0.45, 'rgba(25, 40, 60, 0.08)');
  sGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sCtx.fillStyle = sGrad;
  sCtx.fillRect(0, 0, 512, 512);

  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadowGeo = new THREE.PlaneGeometry(3.3, 2.9);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0.85,
    depthWrite: false
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = -0.06;
  scene.add(shadowMesh);

  // Stage Group
  stageGroup = new THREE.Group();
  scene.add(stageGroup);

  // Ultra HD Canvas Texture for Center Label (2048x2048)
  labelCanvas = document.createElement('canvas');
  labelCanvas.width = LABEL_SIZE;
  labelCanvas.height = LABEL_SIZE;
  labelCtx = labelCanvas.getContext('2d')!;
  labelCtx.imageSmoothingEnabled = true;
  labelCtx.imageSmoothingQuality = 'high';

  labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  labelTexture.generateMipmaps = true;
  labelTexture.minFilter = THREE.LinearMipmapLinearFilter;
  labelTexture.magFilter = THREE.LinearFilter;
  labelTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 16);
  labelTexture.flipY = false;

  drawDynamicLabel();

  // Load 3D Model
  const loader = new GLTFLoader();
  loader.load('/qq_music_gramophone.glb', (gltf) => {
    const model = gltf.scene;

    model.traverse((child: any) => {
      // Hide any foreign floor or plane meshes
      if (child.name.includes('Floor') || child.name === 'Studio_Floor') {
        child.visible = false;
        return;
      }

      if (child.name === 'Turntable_Rotating_Assembly') {
        rotatingAssembly = child;
      }
      if (child.name === 'Tonearm_Root') {
        armRoot = child;
        armBaseY = child.position.y;
      }
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        if (mesh.name.includes('Vinyl_Record')) {
          vinylMesh = mesh;
        } else if (mesh.name.includes('Center_Label')) {
          centerLabelMesh = mesh;
          mesh.material = new THREE.MeshStandardMaterial({
            map: labelTexture,
            roughness: 0.28,
            metalness: 0.0
          });
        } else if (mesh.name.includes('Plinth')) {
          plinthMesh = mesh;
        }
      }
    });

    stageGroup.add(model);

    // Initialize tonearm in rest position (swung to right)
    if (armRoot) {
      armRoot.rotation.y = ARM_ANGLE_REST;
      armRoot.position.y = armBaseY + armLiftY;
      armCurrentAngle = ARM_ANGLE_REST;
      armTargetAngle = ARM_ANGLE_REST;
    }

    updateMaterials();
    updateCameraFraming();
  });

  const viewport = createStageViewport(renderer, container, updateCameraFraming);

  // Animation Loop
  const clock = new THREE.Clock();

  function animate() {
    animId = requestAnimationFrame(animate);
    viewport.sync();
    const delta = Math.min(clock.getDelta(), 0.05);

    // 1. Playback status
    const isPlaying = !!props.track && app.connected && app.room?.playback.playState === 'playing';

    // 2. Vinyl Rotation (clockwise)
    if (isPlaying) {
      const targetSpeed = (stageTheme.turntable.speed / 60) * Math.PI * 2;
      currentRotationSpeed = THREE.MathUtils.lerp(currentRotationSpeed, targetSpeed, delta * 2.8);
    } else {
      currentRotationSpeed = THREE.MathUtils.lerp(currentRotationSpeed, 0, delta * 2.2);
    }

    if (rotatingAssembly && Math.abs(currentRotationSpeed) > 0.0001) {
      rotatingAssembly.rotation.y -= currentRotationSpeed * delta;
    }

    // 3. Tonearm Tracking with Real Playback Progress
    if (armRoot) {
      if (isPlaying) {
        const currentMs = app.progress || 0;
        const totalMs = props.track?.durationMs || 240000;
        const progress = Math.max(0, Math.min(1, totalMs > 0 ? currentMs / totalMs : 0));

        // Arm tracks inward from outer lead-in (0.00 rad) to inner lead-out (-0.35 rad)
        // Stays on the vinyl record for the entire song!
        armTargetAngle = ARM_ANGLE_START + progress * (ARM_ANGLE_END - ARM_ANGLE_START);
        armLiftY = 0.0;
      } else {
        // Paused / stopped -> swings outward to rest post (+0.28 rad)
        armTargetAngle = ARM_ANGLE_REST;
        armLiftY = 0.015;
      }

      armCurrentAngle = THREE.MathUtils.lerp(armCurrentAngle, armTargetAngle, delta * 3.2);
      armCurrentLiftY = THREE.MathUtils.lerp(armCurrentLiftY, armLiftY, delta * 4.2);

      armRoot.rotation.y = armCurrentAngle;
      armRoot.position.y = armBaseY + armCurrentLiftY;
    }

    // Update OrbitControls
    if (controls) {
      controls.update();
    }

    renderer.render(scene, camera);
  }

  animate();

  onUnmounted(() => {
    cancelAnimationFrame(animId);
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
  <div ref="containerRef" class="turntable-3d-stage">
    <!-- 悬浮重置视角快捷按钮 -->
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
.turntable-3d-stage {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: grab;
  user-select: none;
  display: flex;
  justify-content: center;
  align-items: center;
}

.turntable-3d-stage:active {
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
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.15);
  transform: translateY(-1px);
}
</style>