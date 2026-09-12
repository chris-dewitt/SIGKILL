/**
 * The phosphor post-pass.
 *
 * Takes the text canvas as a texture and puts a CRT in front of it: barrel
 * distortion, scanlines, bloom, a vignette, and — the one that actually sells
 * it — phosphor persistence, where a bright glyph decays over several frames
 * instead of vanishing between them.
 *
 * Persistence needs somewhere to remember the previous frame, which is why
 * this keeps two framebuffers and ping-pongs between them.
 */

const VERTEX = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/** Accumulate: new frame max-blended over a decayed copy of the last one. */
const PERSIST = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_previous;
uniform float u_decay;
out vec4 outColor;
void main() {
  vec3 fresh = texture(u_source, v_uv).rgb;
  vec3 ghost = texture(u_previous, v_uv).rgb * u_decay;
  // max, not add: a lit pixel stays lit and fades, but the screen never
  // accumulates into a white haze the way additive blending does.
  outColor = vec4(max(fresh, ghost), 1.0);
}`;

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_frame;
uniform vec2 u_resolution;
uniform float u_curvature;
uniform float u_scanline;
uniform float u_bloom;
uniform float u_vignette;
out vec4 outColor;

/** Pull the corners back, the way a real tube does. */
vec2 curve(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  vec2 offset = abs(uv.yx) / u_curvature;
  uv += uv * offset * offset;
  return uv * 0.5 + 0.5;
}

void main() {
  vec2 uv = curve(v_uv);

  // Off the tube entirely. Black, not clamped edge pixels smeared outward.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 color = texture(u_frame, uv).rgb;

  // Cheap bloom: four taps around the pixel. A real gaussian is not worth
  // the bandwidth on a phone, and phosphor glow is soft anyway.
  vec2 texel = 1.0 / u_resolution;
  vec3 glow = vec3(0.0);
  glow += texture(u_frame, uv + vec2( texel.x * 2.0, 0.0)).rgb;
  glow += texture(u_frame, uv + vec2(-texel.x * 2.0, 0.0)).rgb;
  glow += texture(u_frame, uv + vec2(0.0,  texel.y * 2.0)).rgb;
  glow += texture(u_frame, uv + vec2(0.0, -texel.y * 2.0)).rgb;
  color += glow * 0.25 * u_bloom;

  // Scanlines in device pixels, so they stay one pixel on every display
  // instead of moiring at fractional ratios.
  float line = sin(uv.y * u_resolution.y * 3.14159);
  color *= 1.0 - u_scanline * (0.5 + 0.5 * line * line);

  vec2 fromCentre = uv - 0.5;
  float vignette = 1.0 - dot(fromCentre, fromCentre) * u_vignette;
  color *= clamp(vignette, 0.0, 1.0);

  outColor = vec4(color, 1.0);
}`;

export interface CrtOptions {
  /** Lower is more curved. 0 disables the barrel entirely. */
  curvature?: number;
  /** 0..1 scanline depth. */
  scanline?: number;
  /** Bloom strength. */
  bloom?: number;
  /** Vignette strength. */
  vignette?: number;
  /**
   * Phosphor half-life in milliseconds: how long a lit pixel takes to fade to
   * half brightness.
   *
   * Expressed in time rather than per-frame decay on purpose. A per-frame
   * constant makes the effect depend on refresh rate -- the same glow fades
   * twice as fast on a 120Hz phone as on a 60Hz one -- which is a bug, not a
   * setting.
   *
   * This is what makes it feel like a tube rather than a filter, and the one
   * most likely to be turned down: long persistence bothers people sensitive
   * to motion.
   */
  persistenceHalfLife?: number;
}

const DEFAULTS: Required<CrtOptions> = {
  curvature: 6.0,
  scanline: 0.18,
  bloom: 0.55,
  vignette: 0.55,
  // Short. Real phosphor fades fast; a long tail reads as a smear rather
  // than a glow, and makes scrolling text illegible.
  persistenceHalfLife: 45,
};

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('CRT: could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`CRT: shader failed to compile: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('CRT: could not create program');
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`CRT: program failed to link: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

export class CrtPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly persistProgram: WebGLProgram;
  private readonly compositeProgram: WebGLProgram;
  private readonly quad: WebGLVertexArrayObject;
  private readonly sourceTexture: WebGLTexture;
  private targets: [Target, Target] | undefined;
  private current = 0;
  private width = 0;
  private height = 0;
  private options: Required<CrtOptions>;

  constructor(canvas: HTMLCanvasElement, options: CrtOptions = {}) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      // The composite pass reads the previous frame from its own texture, not
      // from the drawing buffer, so preserving it would only cost bandwidth.
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
    if (!gl) throw new Error('CRT: WebGL2 unavailable');

    this.gl = gl;
    this.options = { ...DEFAULTS, ...options };
    this.persistProgram = link(gl, PERSIST);
    this.compositeProgram = link(gl, COMPOSITE);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('CRT: could not create vertex array');
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.quad = vao;

    this.sourceTexture = createTexture(gl);
  }

  configure(options: CrtOptions): void {
    this.options = { ...this.options, ...options };
  }

  private resize(width: number, height: number): void {
    if (this.width === width && this.height === height && this.targets) return;
    const gl = this.gl;

    for (const target of this.targets ?? []) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }

    this.targets = [makeTarget(gl, width, height), makeTarget(gl, width, height)];
    this.width = width;
    this.height = height;
  }

  /**
   * Draw one frame from the text canvas.
   *
   * `elapsedMs` is the time since the previous frame, and drives the decay so
   * the glow lasts the same wall-clock duration at any refresh rate.
   */
  render(source: HTMLCanvasElement | OffscreenCanvas, elapsedMs = 16.7): void {
    const gl = this.gl;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    if (width === 0 || height === 0) return;

    this.resize(width, height);
    const targets = this.targets;
    if (!targets) return;

    gl.bindVertexArray(this.quad);

    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    // WebGL's texture origin is bottom-left; a canvas's is top-left. Without
    // this the whole screen renders upside down. Only the canvas upload needs
    // it -- the framebuffer textures are written by the shader and are
    // already in GL orientation, so flipping those too would undo it.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    // Pass 1 — accumulate persistence into the target we are not reading.
    const [a, b] = targets;
    const previous = this.current === 0 ? a : b;
    const next = this.current === 0 ? b : a;

    gl.bindFramebuffer(gl.FRAMEBUFFER, next.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.persistProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.uniform1i(gl.getUniformLocation(this.persistProgram, 'u_source'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, previous.texture);
    gl.uniform1i(gl.getUniformLocation(this.persistProgram, 'u_previous'), 1);

    // Half-life to per-frame multiplier: after `halfLife` ms, 0.5.
    const decay = Math.pow(0.5, Math.max(0, elapsedMs) / this.options.persistenceHalfLife);
    gl.uniform1f(gl.getUniformLocation(this.persistProgram, 'u_decay'), decay);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Pass 2 — curve, scan, bloom and vignette onto the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.compositeProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, next.texture);
    gl.uniform1i(gl.getUniformLocation(this.compositeProgram, 'u_frame'), 0);
    gl.uniform2f(gl.getUniformLocation(this.compositeProgram, 'u_resolution'), width, height);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_curvature'), this.options.curvature);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_scanline'), this.options.scanline);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_bloom'), this.options.bloom);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_vignette'), this.options.vignette);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
    this.current = this.current === 0 ? 1 : 0;
  }

  dispose(): void {
    const gl = this.gl;
    for (const target of this.targets ?? []) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    gl.deleteTexture(this.sourceTexture);
    gl.deleteProgram(this.persistProgram);
    gl.deleteProgram(this.compositeProgram);
    gl.deleteVertexArray(this.quad);
    this.targets = undefined;
  }
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('CRT: could not create texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

function makeTarget(gl: WebGL2RenderingContext, width: number, height: number): Target {
  const texture = createTexture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) throw new Error('CRT: could not create framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  // Start black, or the first frame of persistence samples uninitialised memory.
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { framebuffer, texture };
}
