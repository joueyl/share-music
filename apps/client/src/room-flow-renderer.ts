import { coverCrop, roomFlowPreset } from './room-flow-preset';
import { flowShaders } from './room-flow-shaders';

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number };
const radians = Math.PI / 180;
const tau = Math.PI * 2;

export function createRoomFlow(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('webgl', { alpha: false, antialias: false });
  if (!context) return null;
  const gl = context;
  // This is a heavily blurred background. Preserve the original pipeline geometry
  // and filter radii in preset pixels while limiting offscreen GPU work.
  const renderScale = .5;
  const { parameters: p, filterEnabled, view, playback, image } = roomFlowPreset;
  const width = canvas.width = image.width * renderScale;
  const height = canvas.height = image.height * renderScale;
  const aspect = width / height;
  const filter = (key: keyof typeof filterEnabled) => filterEnabled[key] ? p[key] : 0;
  const programs: WebGLProgram[] = [], targets: Target[] = [], textures: WebGLTexture[] = [];
  const buffer = gl.createBuffer();
  let sourceTexture: WebGLTexture | null = null;
  let elapsed = 0;
  function dispose() {
    for (const program of programs) gl.deleteProgram(program);
    for (const target of targets) gl.deleteFramebuffer(target.framebuffer);
    for (const texture of textures) gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
  }
  try {
    const shaderFloat = (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0) > 0 ? 'highp' : 'mediump';
    const shaders = flowShaders(shaderFloat);
    function compile(type: number, code: string) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Flow Lab shader unavailable');
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(message ?? 'Flow Lab shader compilation failed');
    }
    function pass<K extends string>(code: string, names: readonly K[]) {
      const context = gl;
      const program = context.createProgram();
      if (!program) throw new Error('Flow Lab program unavailable');
      programs.push(program);
      const vertex = compile(context.VERTEX_SHADER, shaders.vertex);
      try {
        const fragment = compile(context.FRAGMENT_SHADER, code);
        try {
          context.attachShader(program, vertex);
          context.attachShader(program, fragment);
          context.bindAttribLocation(program, 0, 'position');
          context.linkProgram(program);
          if (!context.getProgramParameter(program, context.LINK_STATUS)) {
            throw new Error(context.getProgramInfoLog(program) ?? 'Flow Lab program link failed');
          }
        } finally {
          context.detachShader(program, fragment);
          context.deleteShader(fragment);
        }
      } finally {
        if (context.getAttachedShaders(program)?.includes(vertex)) context.detachShader(program, vertex);
        context.deleteShader(vertex);
      }
      const uniforms = Object.fromEntries(names.map(name => [name, context.getUniformLocation(program, name)])) as Record<K, WebGLUniformLocation | null>;
      return { program, image: context.getUniformLocation(program, 'image'), uniforms };
    }
    function newTexture() {
      const context = gl;
      const texture = context.createTexture();
      if (!texture) throw new Error('Flow Lab texture unavailable');
      textures.push(texture);
      context.bindTexture(context.TEXTURE_2D, texture);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
      return texture;
    }
    function newTarget(w: number, h: number) {
      const context = gl;
      const texture = newTexture();
      context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, w, h, 0, context.RGBA, context.UNSIGNED_BYTE, null);
      const framebuffer = context.createFramebuffer();
      if (!framebuffer) throw new Error('Flow Lab framebuffer unavailable');
      const target = { texture, framebuffer, width: w, height: h };
      targets.push(target);
      context.bindFramebuffer(context.FRAMEBUFFER, framebuffer);
      context.framebufferTexture2D(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.TEXTURE_2D, texture, 0);
      if (context.checkFramebufferStatus(context.FRAMEBUFFER) !== context.FRAMEBUFFER_COMPLETE) throw new Error('Flow Lab framebuffer incomplete');
      return target;
    }
    function begin(pass: { program: WebGLProgram; image: WebGLUniformLocation | null }, target: Target | null, texture: WebGLTexture) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
      gl.viewport(0, 0, target?.width ?? width, target?.height ?? height);
      gl.useProgram(pass.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(pass.image, 0);
    }

    if (!buffer) throw new Error('Flow Lab buffer unavailable');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const compose = pass(shaders.compositionFragment, ['aspect', 'splitMode', 'allowOverflow', 'texel', 'imageRotations'] as const);
    const blur = pass(shaders.blurFragment, ['sigma', 'direction'] as const);
    const optical = pass(shaders.opticalFragment, ['direction', 'resolution', 'radial'] as const);
    const copy = pass(shaders.copyFragment, []);
    const output = pass(shaders.fragment, ['geometry', 'texel', 'tone', 'time', 'strength', 'scale', 'aspect', 'compare', 'rotation', 'swirl', 'ripple', 'chromatic', 'wave', 'pixelate', 'halftone', 'grain', 'vignette'] as const);

    const composite = newTarget(width, height);
    const radius = filter('blur') * renderScale;
    const blurScale = Math.min(1, 8 / radius);
    const blurWidth = Math.max(1, Math.round(width * blurScale));
    const blurHeight = Math.max(1, Math.round(height * blurScale));
    const horizontal = radius > 0 ? newTarget(blurWidth, blurHeight) : null;
    const vertical = horizontal ? newTarget(blurWidth, blurHeight) : null;
    const directional = filter('directional') > 0 ? newTarget(width, height) : null;
    const zoom = filter('zoomBlur') > 0 ? newTarget(width, height) : null;
    const zoomInput = zoom ? newTarget(2 ** Math.ceil(Math.log2(width)), 2 ** Math.ceil(Math.log2(height))) : null;
    const rotations = new Float32Array(3);
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const drawingContext = source.getContext('2d', { alpha: false });
    if (!drawingContext) throw new Error('Flow Lab artwork canvas unavailable');
    const paint = drawingContext;

    function setImage(cover: HTMLImageElement) {
      if (gl.isContextLost()) return false;
      paint.fillStyle = '#e4ecf8';
      paint.fillRect(0, 0, width, height);
      paint.drawImage(cover, ...coverCrop(cover.naturalWidth, cover.naturalHeight, width, height), 0, 0, width, height);
      sourceTexture ??= newTexture();
      gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      return gl.getError() === gl.NO_ERROR;
    }

    function draw(dt: number) {
      if (!sourceTexture || gl.isContextLost()) return false;
      if (!playback.paused) elapsed += dt;
      const angle = p.angle * radians + (playback.filterRotationPhase + elapsed * p.spin * radians) % tau;
      rotations[0] = p.leftAngle * radians + (playback.leftRotationPhase + elapsed * p.leftSpin * radians) % tau;
      rotations[1] = p.imageAngle * radians + (playback.centerRotationPhase + elapsed * p.imageSpin * radians) % tau;
      rotations[2] = p.rightAngle * radians + (playback.rightRotationPhase + elapsed * p.rightSpin * radians) % tau;
      const context = gl;
      const drawQuad = () => context.drawArrays(context.TRIANGLES, 0, 6);

      begin(compose, composite, sourceTexture);
      context.uniform1f(compose.uniforms.aspect, aspect);
      context.uniform1f(compose.uniforms.splitMode, Number(view.splitView));
      context.uniform1f(compose.uniforms.allowOverflow, Number(view.allowOverflow));
      context.uniform2f(compose.uniforms.texel, 1 / width, 1 / height);
      context.uniform3fv(compose.uniforms.imageRotations, rotations);
      drawQuad();
      let texture = composite.texture;
      if (horizontal && vertical) {
        begin(blur, horizontal, texture);
        context.uniform1f(blur.uniforms.sigma, radius * blurScale);
        context.uniform2f(blur.uniforms.direction, 1 / blurWidth, 0);
        drawQuad();
        begin(blur, vertical, horizontal.texture);
        context.uniform2f(blur.uniforms.direction, 0, 1 / blurHeight);
        drawQuad();
        texture = vertical.texture;
      }
      if (directional) {
        const distance = filter('directional') * renderScale;
        begin(optical, directional, texture);
        context.uniform2f(optical.uniforms.direction, Math.cos(angle) * distance / width, -Math.sin(angle) * distance / height);
        context.uniform1f(optical.uniforms.radial, 0);
        drawQuad();
        texture = directional.texture;
      }
      if (zoom && zoomInput) {
        begin(copy, zoomInput, texture);
        drawQuad();
        context.bindFramebuffer(context.FRAMEBUFFER, null);
        context.bindTexture(context.TEXTURE_2D, zoomInput.texture);
        context.generateMipmap(context.TEXTURE_2D);
        context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR_MIPMAP_LINEAR);
        begin(optical, zoom, zoomInput.texture);
        context.uniform2f(optical.uniforms.direction, 0, 0);
        context.uniform2f(optical.uniforms.resolution, width, height);
        context.uniform1f(optical.uniforms.radial, filter('zoomBlur') / 100 * .3);
        drawQuad();
        texture = zoom.texture;
      }

      begin(output, null, texture);
      const u = output.uniforms;
      context.uniform2f(u.geometry, filter('lens') / 100, filter('sharpen') / 100);
      context.uniform2f(u.texel, 1 / width, 1 / height);
      context.uniform4f(u.tone, filter('exposure'), filter('contrast') / 100, filter('saturation') / 100, filter('temperature') / 100);
      context.uniform1f(u.time, playback.time + elapsed * p.speed);
      context.uniform1f(u.strength, filter('strength') / 100);
      context.uniform1f(u.scale, p.scale);
      context.uniform1f(u.aspect, aspect);
      context.uniform1f(u.compare, 0);
      context.uniform1f(u.rotation, angle);
      for (const key of ['swirl', 'ripple', 'chromatic', 'wave', 'pixelate', 'halftone', 'grain', 'vignette'] as const) {
        context.uniform1f(u[key], filter(key) / 100);
      }
      drawQuad();
      return true;
    }
    return { setImage, draw, dispose };
  } catch {
    dispose();
    return null;
  }
}
