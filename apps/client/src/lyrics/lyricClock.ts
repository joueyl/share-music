// 非响应式播放时钟：与 Date.now() 同基准、亚毫秒精度。
// store 的 progress 由 setInterval 50ms 驱动（20Hz），对 100ms 量级的短字太粗，
// 会让逐字扫光「跳」。这里用 rAF 提供帧级触发，但只在三态翻转时写 Vue ref，
// 渐变与扫光交给 CSS 合成器，避免逐帧操作 DOM 或触发整列表重渲染。
type Tick = (nowMs: number) => void;

const subscribers = new Set<Tick>();
let frameHandle = 0;
let usingRaf = false;

/** 与 Date.now() 同基准的高精度时间戳（ms），可直接喂给 positionAt */
export function nowMs(): number {
  return typeof performance !== 'undefined' && performance.timeOrigin
    ? performance.timeOrigin + performance.now()
    : Date.now();
}

function frame(): void {
  frameHandle = 0;
  const t = nowMs();
  for (const cb of [...subscribers]) cb(t);
  if (subscribers.size) schedule();
}

function schedule(): void {
  if (typeof requestAnimationFrame === 'function') {
    usingRaf = true;
    frameHandle = requestAnimationFrame(frame);
  } else {
    // 测试环境或无 rAF 时退化为定时器，保证时序逻辑仍可跑通
    usingRaf = false;
    frameHandle = setTimeout(frame, 16) as unknown as number;
  }
}

function cancel(): void {
  if (!frameHandle) return;
  if (usingRaf) cancelAnimationFrame(frameHandle);
  else clearTimeout(frameHandle as unknown as ReturnType<typeof setTimeout>);
  frameHandle = 0;
}

/** 订阅时钟；返回取消函数。最后一个订阅者离开时自动停帧。 */
export function subscribeLyricClock(cb: Tick): () => void {
  subscribers.add(cb);
  cb(nowMs()); // 立刻对齐一次，避免 seek 后停留错态
  if (!frameHandle) schedule();
  return () => {
    subscribers.delete(cb);
    if (!subscribers.size) cancel();
  };
}
