import { reactive, watch } from 'vue';

export interface IpodThemeConfig {
  preset: string;
  bodyColor: string;
  wheelColor: string;
  buttonColor: string;
  roughness: number;
  metalness: number;
  parallaxTilt: boolean;
  beatPulse: boolean;
}

export interface TurntableThemeConfig {
  vinylEdition: 'silver' | 'black' | 'gold' | 'emerald';
  plinthColor: 'white' | 'slate' | 'wood' | 'sage';
  speed: number;
  parallaxTilt: boolean;
}

export type LumiereMotionIntensity = 'calm' | 'normal' | 'chaotic';

export interface LumiereThemeConfig {
  preset: string;
  /** 激活色：正在演唱的字的主体色与光晕色 */
  primary: string;
  /** 辅助色：光晕外环与环境光晕 */
  secondary: string;
  /** 基础色：未唱与已唱的字 */
  base: string;
  /** 逐字光晕扫过的拖尾 */
  sweep: boolean;
  /** 未唱字的景深散焦（blur 浮现） */
  depthBlur: boolean;
  /** 动效强度：同时决定逐字散开幅度与整行呼吸幅度（calm 即不散开） */
  motion: LumiereMotionIntensity;
  /** 整行呼吸漂浮 */
  breathing: boolean;
  /** 词间距倍率：0 收紧，2 松散 */
  wordSpacing: number;
}

export type StageMode = 'turntable' | 'ipod' | 'lumiere';

export interface StageThemeState {
  mode: StageMode;
  ipod: IpodThemeConfig;
  turntable: TurntableThemeConfig;
  lumiere: LumiereThemeConfig;
}

export const TURNTABLE_VINYL_EDITIONS = {
  silver: { name: '白金银 (原版)', color: '#d8dedb', metalness: 0.88, roughness: 0.22 },
  black: { name: '经典黑胶', color: '#141615', metalness: 0.15, roughness: 0.28 },
  gold: { name: '典藏香槟金', color: '#ecd588', metalness: 0.90, roughness: 0.20 },
  emerald: { name: '墨玉翡翠绿', color: '#244f3d', metalness: 0.55, roughness: 0.25 }
};

export const TURNTABLE_PLINTH_COLORS = {
  white: { name: '陶瓷暖白', color: '#f6f7f4', roughness: 0.35 },
  slate: { name: '深空哑灰', color: '#2d3748', roughness: 0.40 },
  wood: { name: '北欧原木', color: '#cc9966', roughness: 0.55 },
  sage: { name: '鼠尾草绿', color: '#5e8b7e', roughness: 0.38 }
};

export const IPOD_PRESETS: Record<string, { name: string; bodyColor: string; wheelColor: string; buttonColor: string; roughness: number; metalness: number }> = {
  u2: {
    name: 'U2 特别版',
    bodyColor: '#1a1a1c',
    wheelColor: '#d61b24',
    buttonColor: '#1a1a1c',
    roughness: 0.35,
    metalness: 0.15
  },
  silver: {
    name: '经典银白',
    bodyColor: '#d8dbe2',
    wheelColor: '#f2f2f7',
    buttonColor: '#d8dbe2',
    roughness: 0.28,
    metalness: 0.45
  },
  retro_white: {
    name: '复古白巧',
    bodyColor: '#faf8f5',
    wheelColor: '#e5e5ea',
    buttonColor: '#faf8f5',
    roughness: 0.2,
    metalness: 0.05
  },
  space_gray: {
    name: '深空暗灰',
    bodyColor: '#2c2d30',
    wheelColor: '#1b1b1d',
    buttonColor: '#2c2d30',
    roughness: 0.4,
    metalness: 0.3
  },
  cyber_neon: {
    name: '赛博霓虹',
    bodyColor: '#120f24',
    wheelColor: '#00e5ff',
    buttonColor: '#ff007f',
    roughness: 0.25,
    metalness: 0.5
  }
};

const STORAGE_KEY = 'tone_stage_theme_settings_v1';

export const LUMIERE_PRESETS: Record<string, { name: string; primary: string; secondary: string; base: string }> = {
  ocean: {
    name: '流光蓝',
    primary: '#1d6fee',
    secondary: '#00b4d8',
    base: '#64748b'
  },
  dawn: {
    name: '晨曦金',
    primary: '#c2410c',
    secondary: '#f59e0b',
    base: '#78716c'
  },
  aurora: {
    name: '极光紫',
    primary: '#7c3aed',
    secondary: '#a855f7',
    base: '#6b7280'
  }
};

const LUMIERE_DEFAULT = LUMIERE_PRESETS.ocean;

// 旧存档可能没有 lumiere 段，逐字段回落到流光蓝默认值（与 ipod/turntable 的缺省策略一致）
function resolveLumiere(saved?: Partial<LumiereThemeConfig>): LumiereThemeConfig {
  const motion = saved?.motion;
  return {
    preset: saved?.preset || 'ocean',
    primary: saved?.primary || LUMIERE_DEFAULT.primary,
    secondary: saved?.secondary || LUMIERE_DEFAULT.secondary,
    base: saved?.base || LUMIERE_DEFAULT.base,
    sweep: saved?.sweep !== false,
    depthBlur: saved?.depthBlur !== false,
    motion: motion === 'calm' || motion === 'chaotic' ? motion : 'normal',
    breathing: saved?.breathing !== false,
    wordSpacing: typeof saved?.wordSpacing === 'number'
      ? Math.min(2, Math.max(0, saved.wordSpacing))
      : 0.7
  };
}

function loadInitialState(): StageThemeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.mode === 'turntable' || parsed.mode === 'ipod' || parsed.mode === 'lumiere')) {
        return {
          mode: parsed.mode,
          ipod: {
            preset: parsed.ipod?.preset || 'u2',
            bodyColor: parsed.ipod?.bodyColor || IPOD_PRESETS.u2.bodyColor,
            wheelColor: parsed.ipod?.wheelColor || IPOD_PRESETS.u2.wheelColor,
            buttonColor: parsed.ipod?.buttonColor || IPOD_PRESETS.u2.buttonColor,
            roughness: typeof parsed.ipod?.roughness === 'number' ? parsed.ipod.roughness : 0.35,
            metalness: typeof parsed.ipod?.metalness === 'number' ? parsed.ipod.metalness : 0.15,
            parallaxTilt: parsed.ipod?.parallaxTilt !== false,
            beatPulse: parsed.ipod?.beatPulse !== false
          },
          turntable: {
            vinylEdition: parsed.turntable?.vinylEdition || 'silver',
            plinthColor: parsed.turntable?.plinthColor || 'white',
            // 若旧配置为过快的 33.33/45 RPM，重置为舒适的 3.3 RPM 视觉缓速
            speed: (typeof parsed.turntable?.speed === 'number' && parsed.turntable.speed <= 10) ? parsed.turntable.speed : 3.3,
            parallaxTilt: parsed.turntable?.parallaxTilt !== false
          },
          lumiere: resolveLumiere(parsed.lumiere)
        };
      }
    }
  } catch (e) {
    console.warn('Failed to parse saved theme settings', e);
  }
  return {
    mode: 'turntable',
    ipod: {
      preset: 'u2',
      bodyColor: IPOD_PRESETS.u2.bodyColor,
      wheelColor: IPOD_PRESETS.u2.wheelColor,
      buttonColor: IPOD_PRESETS.u2.buttonColor,
      roughness: IPOD_PRESETS.u2.roughness,
      metalness: IPOD_PRESETS.u2.metalness,
      parallaxTilt: true,
      beatPulse: true
    },
    turntable: {
      vinylEdition: 'silver',
      plinthColor: 'white',
      speed: 3.3, // 默认 3.3 RPM，约 18-20 秒一圈，QQ音乐/网易云同款视觉惬意慢转
      parallaxTilt: true
    },
    lumiere: resolveLumiere()
  };
}

export const stageTheme = reactive<StageThemeState>(loadInitialState());

watch(
  stageTheme,
  (val) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
    } catch (e) {
      console.warn('Failed to save theme settings', e);
    }
  },
  { deep: true }
);

export function applyPreset(presetKey: string) {
  const p = IPOD_PRESETS[presetKey];
  if (!p) return;
  stageTheme.ipod.preset = presetKey;
  stageTheme.ipod.bodyColor = p.bodyColor;
  stageTheme.ipod.wheelColor = p.wheelColor;
  stageTheme.ipod.buttonColor = p.buttonColor;
  stageTheme.ipod.roughness = p.roughness;
  stageTheme.ipod.metalness = p.metalness;
}

export function applyLumierePreset(presetKey: string) {
  const p = LUMIERE_PRESETS[presetKey];
  if (!p) return;
  stageTheme.lumiere.preset = presetKey;
  stageTheme.lumiere.primary = p.primary;
  stageTheme.lumiere.secondary = p.secondary;
  stageTheme.lumiere.base = p.base;
}

/** hex → "r, g, b"，供 CSS 里 rgba(var(--x-rgb), a) 调透明度 */
export function hexToRgbTriplet(hex: string): string {
  const raw = (hex ?? '').replace('#', '');
  const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
  if (full.length !== 6) return '0, 0, 0';
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return '0, 0, 0';
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

export type CssVars = Record<string, string>;

/** 绑到舞台节点的 :style，让流光配色统一走 CSS 变量而非散落的硬编码 */
export function lumiereCssVars(theme: LumiereThemeConfig): CssVars {
  return {
    '--lumiere-primary': theme.primary,
    '--lumiere-primary-rgb': hexToRgbTriplet(theme.primary),
    '--lumiere-secondary': theme.secondary,
    '--lumiere-secondary-rgb': hexToRgbTriplet(theme.secondary),
    '--lumiere-base': theme.base,
    '--lumiere-base-rgb': hexToRgbTriplet(theme.base)
  };
}
