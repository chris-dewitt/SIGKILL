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
uniform float u_time;
uniform float u_curvature;
uniform float u_scanline;
uniform float u_bloom;
uniform float u_vignette;
uniform float u_mask;
uniform float u_flicker;
uniform float u_grain;
uniform float u_aberration;
uniform float u_jitter;
uniform float u_roll;
uniform float u_brightness;
out vec4 outColor;

/** Cheap hash. Deterministic per pixel per frame, no texture lookup. */
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

/** Pull the corners back, the way a real tube does. */
vec2 curve(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  vec2 offset = abs(uv.yx) / u_curvature;
  uv += uv * offset * offset;
  return uv * 0.5 + 0.5;
}

void main() {
  vec2 uv = curve(v_uv);

  /*
   * Horizontal sync instability.
   *
   * A whole scanline slips sideways, and only some of them, only sometimes.
   * This is the single most legible "the hardware is failing" cue there is --
   * far more than noise, because a person reads it as the *picture* breaking
   * rather than as a dirty screen.
   */
  if (u_jitter > 0.0) {
    float row = floor(uv.y * u_resolution.y);
    float when = hash(vec2(row, floor(u_time * 11.0)));
    float slip = step(1.0 - u_jitter * 0.12, when);
    uv.x += slip * (hash(vec2(row, u_time)) - 0.5) * 0.03 * u_jitter;
  }

  // Off the tube entirely. Black, not clamped edge pixels smeared outward.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec2 texel = 1.0 / u_resolution;

  /*
   * Chromatic aberration: the three guns land fractionally apart.
   *
   * Sampled per channel rather than as one colour, which is what gives white
   * text its faint red and blue fringes -- the thing that reads as a tube and
   * not as a font.
   */
  vec3 color;
  if (u_aberration > 0.0) {
    float shift = texel.x * u_aberration * 1.6;
    color.r = texture(u_frame, uv + vec2(shift, 0.0)).r;
    color.g = texture(u_frame, uv).g;
    color.b = texture(u_frame, uv - vec2(shift, 0.0)).b;
  } else {
    color = texture(u_frame, uv).rgb;
  }

  // Cheap bloom: four taps around the pixel. A real gaussian is not worth
  // the bandwidth on a phone, and phosphor glow is soft anyway.
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

  /*
   * The aperture grille: vertical R, G and B stripes.
   *
   * This is the effect people mean when they say a screen looks like a CRT,
   * and it is the reason a shadow-mask tube makes every colour look richer
   * than it is -- each channel is lit separately rather than blended in one
   * phosphor. It costs one modulo and pays for itself.
   */
  if (u_mask > 0.0) {
    float column = mod(floor(v_uv.x * u_resolution.x), 3.0);
    vec3 grille = vec3(
      column < 1.0 ? 1.0 : 0.55,
      (column >= 1.0 && column < 2.0) ? 1.0 : 0.55,
      column >= 2.0 ? 1.0 : 0.55
    );
    color *= mix(vec3(1.0), grille, u_mask);
    // The mask eats light, so give some back or every preset looks dimmer
    // than the one below it for reasons nobody asked for.
    color *= 1.0 + u_mask * 0.45;
  }

  /*
   * A brightness band drifting down the screen.
   *
   * A tube whose vertical hold is going. Slow, because a fast one is a
   * strobe and nobody should have to sit in front of that.
   */
  if (u_roll > 0.0) {
    float band = fract(v_uv.y + u_time * 0.08);
    color *= 1.0 + u_roll * 0.16 * smoothstep(0.96, 1.0, band);
  }

  // Mains-frequency brightness wobble. Two incommensurate rates, so it never
  // settles into a rhythm the eye can predict and start ignoring.
  if (u_flicker > 0.0) {
    float wobble = sin(u_time * 47.0) * 0.6 + sin(u_time * 13.3) * 0.4;
    color *= 1.0 - u_flicker * 0.06 * (0.5 + 0.5 * wobble);
  }

  // Grain, after everything else: it is the tube, not the signal.
  if (u_grain > 0.0) {
    float n = hash(v_uv * u_resolution + u_time * 60.0) - 0.5;
    color += n * u_grain * 0.09;
  }

  vec2 fromCentre = uv - 0.5;
  float vignette = 1.0 - dot(fromCentre, fromCentre) * u_vignette;
  color *= clamp(vignette, 0.0, 1.0);

  outColor = vec4(color * u_brightness, 1.0);
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
   * 0..1 aperture grille: vertical red, green and blue stripes.
   *
   * The effect people actually mean when they say a screen looks like a CRT.
   * It is also why a shadow-mask tube makes colour look richer than it is --
   * each channel is lit separately instead of blended in one phosphor.
   */
  mask?: number;
  /** 0..1 mains-frequency brightness wobble. */
  flicker?: number;
  /** 0..1 tube grain. */
  grain?: number;
  /** 0..1 separation of the three guns. Gives white text colour fringes. */
  aberration?: number;
  /**
   * 0..1 horizontal sync instability: whole scanlines slipping sideways.
   *
   * The most legible "this hardware is failing" cue available, because a
   * person reads it as the picture breaking rather than as a dirty screen.
   */
  jitter?: number;
  /** 0..1 brightness band drifting down the screen: a failing vertical hold. */
  roll?: number;
  /** Overall gain, applied last. */
  brightness?: number;
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
  mask: 0,
  flicker: 0,
  grain: 0,
  aberration: 0,
  jitter: 0,
  roll: 0,
  brightness: 1,
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
    /*
     * When the tube was switched on.
     *
     * Every time-based effect measures from here rather than from frame count,
     * so flicker and roll run at the same speed on a 60Hz phone and a 120Hz
     * one. A per-frame counter would make a failing ship look twice as sick on
     * better hardware.
     */
    this.born = performance.now();
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

  /** When the tube was switched on. See the constructor. */
  private readonly born: number;

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
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_mask'), this.options.mask);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_flicker'), this.options.flicker);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_grain'), this.options.grain);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_aberration'), this.options.aberration);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_jitter'), this.options.jitter);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_roll'), this.options.roll);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_brightness'), this.options.brightness);
    // Seconds since the pass was built. Every time-based effect reads this,
    // so they all agree and none of them depend on frame rate.
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_time'), (performance.now() - this.born) / 1000);
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
