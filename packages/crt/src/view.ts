import { TerminalBuffer, type LineKind, type Span } from './buffer.js';
import { CrtPass, type CrtOptions } from './crt.js';
import { atBottom } from './metrics.js';
import { TerminalRenderer, type Palette } from './renderer.js';

/**
 * How long to keep redrawing after the last change.
 *
 * Roughly seven half-lives at the default, by which point the ghost is under
 * one percent and invisible.
 */
const SETTLE_MS = 320;

/**
 * Fraction of each edge the barrel curve eats.
 *
 * Measured against the default curvature: the corners displace by about
 * (1/curvature)^2, and a little more than that keeps the last column clear of
 * the bend rather than sitting exactly on it.
 */
const OVERSCAN = 0.045;

/** Probe for WebGL2 without constructing the pass, so the decision is made once. */
function supportsWebgl2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export interface ViewOptions {
  font: string;
  palette?: Palette;
  gutter?: number;
  crt?: CrtOptions;
  /**
   * Draw without the shader.
   *
   * Set when WebGL2 is unavailable, or by a player who finds the phosphor
   * persistence uncomfortable — it is the kind of effect that bothers people
   * sensitive to motion, so it has to be switchable.
   */
  plain?: boolean;
}

/**
 * The terminal screen.
 *
 * Owns the canvas, the CRT pass, and an accessibility mirror. It deliberately
 * does **not** own the prompt: the app keeps a real `<input>` below the
 * screen, which gives correct IME composition, selection, autocorrect control
 * and screen-reader behaviour for free. Terminal emulators hide an input
 * inside the canvas because they must draw their own cursor; this game has a
 * separate prompt line, so reimplementing any of that would be strictly
 * worse.
 */
export class TerminalView {
  readonly buffer = new TerminalBuffer();
  readonly element: HTMLElement;

  private readonly renderer: TerminalRenderer;
  private readonly glCanvas: HTMLCanvasElement;
  private readonly mirror: HTMLElement;
  private crt: CrtPass | undefined;
  private frame = 0;
  private lastRevision = -1;
  private lastScroll = -1;
  /** Wall-clock ms still worth drawing after a change, so persistence decays. */
  private settleMs = 0;
  private lastFrameAt = 0;
  private scroll = 0;
  /** A full-screen program's frame, drawn instead of the scrollback. */
  private overlay: TerminalBuffer | undefined;
  /** Bumped whenever the overlay is replaced or dropped, to force a redraw. */
  private overlaySerial = 0;
  private lastOverlaySerial = -1;
  private observer: ResizeObserver | undefined;
  private disposed = false;

  constructor(container: HTMLElement, opts: ViewOptions) {
    this.element = container;
    // Decided before the renderer is built: the shader bends the image, so
    // the text grid has to be inset to match. Plain mode bends nothing.
    const accelerated = !opts.plain && supportsWebgl2();

    this.renderer = new TerminalRenderer({
      font: opts.font,
      ...(opts.palette ? { palette: opts.palette } : {}),
      ...(opts.gutter !== undefined ? { gutter: opts.gutter } : {}),
      overscan: accelerated ? OVERSCAN : 0,
    });

    this.glCanvas = document.createElement('canvas');
    this.glCanvas.className = 'crt-screen';
    // The canvas is decorative; the mirror below carries the text.
    this.glCanvas.setAttribute('aria-hidden', 'true');
    container.append(this.glCanvas);

    this.mirror = document.createElement('div');
    this.mirror.className = 'crt-mirror';
    this.mirror.setAttribute('role', 'log');
    this.mirror.setAttribute('aria-live', 'polite');
    this.mirror.setAttribute('aria-label', 'Terminal output');
    container.append(this.mirror);

    if (accelerated) {
      try {
        this.crt = new CrtPass(this.glCanvas, opts.crt ?? {});
      } catch {
        // No WebGL2. Fall back to the plain canvas rather than failing to
        // render at all — the game is legible either way.
        this.crt = undefined;
      }
    }

    this.observe(container);
    this.measure();
    this.loop();
  }

  /** True when the shader is running. False means the fallback path. */
  get accelerated(): boolean {
    return this.crt !== undefined;
  }

  get columns(): number {
    return this.renderer.columns;
  }

  /** Rows the screen can show. A full-screen program needs both dimensions. */
  get rows(): number {
    return this.renderer.rows;
  }

  /** True while a full-screen program owns the screen. */
  get showingScreen(): boolean {
    return this.overlay !== undefined;
  }

  /**
   * Hand the whole screen to a full-screen program.
   *
   * The scrollback is not touched, so leaving the editor puts the player back
   * exactly where they were -- which is the behaviour of a real terminal and
   * the reason this is an overlay rather than a `clear`.
   *
   * Lines are drawn as given: no wrapping happens because the program is told
   * the real column count and truncates to it.
   */
  showScreen(lines: ReadonlyArray<{ text: string; kind: LineKind; cursor?: number }>): void {
    const frame = new TerminalBuffer();
    for (const line of lines) frame.push(line.text, line.kind, line.cursor);
    this.overlay = frame;
    this.overlaySerial++;
  }

  hideScreen(): void {
    if (this.overlay === undefined) return;
    this.overlay = undefined;
    this.overlaySerial++;
  }

  /**
   * Colour runs inside every line this view writes.
   *
   * Set once by the host, because the rules need to know which words are real
   * commands aboard and the view is the only thing that sees every line.
   */
  highlighter: ((text: string) => readonly Span[]) | undefined;

  /** Push one line, colouring it if a highlighter is installed. */
  private line(text: string, kind: LineKind, nowrap = false): void {
    const spans = text.length > 0 ? this.highlighter?.(text) : undefined;
    this.buffer.pushLine({
      text,
      kind,
      ...(nowrap ? { nowrap: true } : {}),
      ...(spans !== undefined && spans.length > 0 ? { spans } : {}),
    });
  }

  /**
   * Swap the colour scheme without losing the session.
   *
   * The atlas bakes colour into its sheets, so this rebuilds the renderer --
   * the buffer is untouched, which is what lets somebody compare two schemes
   * against the same screenful instead of against their memory of it.
   */
  setPalette(palette: Palette): void {
    this.renderer.setPalette(palette);
    this.draw();
  }

  write(text: string, kind: LineKind = 'out'): void {
    const wasAtBottom = this.isAtBottom();
    this.writeLines(text, kind);
    // New output only chases the bottom if the player was already there.
    // Yanking them forward mid-scroll is the classic terminal annoyance.
    if (wasAtBottom) this.scroll = 0;
  }

  /** Split a block on newlines the way `TerminalBuffer.write` does. */
  private writeLines(text: string, kind: LineKind): void {
    if (text.length === 0) return;
    const parts = text.split('\n');
    if (parts[parts.length - 1] === '') parts.pop();
    for (const part of parts) this.line(part, kind);
  }

  push(text: string, kind: LineKind = 'out'): void {
    const wasAtBottom = this.isAtBottom();
    this.line(text, kind);
    if (wasAtBottom) this.scroll = 0;
  }

  /**
   * Write a block of art, clipped to the width rather than reflowed.
   *
   * The separate entry point is the whole point: a drawing that goes through
   * `write` comes out the other side as confetti on a narrow screen.
   */
  writeArt(rows: readonly string[], kind: LineKind = 'out'): void {
    const wasAtBottom = this.isAtBottom();
    for (const row of rows) this.line(row, kind, true);
    if (wasAtBottom) this.scroll = 0;
  }

  clear(): void {
    this.buffer.clear();
    this.scroll = 0;
  }

  scrollBy(rows: number): void {
    const total = this.buffer.height(this.renderer.columns);
    const max = Math.max(0, total - this.renderer.rows);
    this.scroll = Math.min(Math.max(0, this.scroll + rows), max);
  }

  scrollToBottom(): void {
    this.scroll = 0;
  }

  private isAtBottom(): boolean {
    return atBottom(this.buffer.height(this.renderer.columns), this.renderer.rows, this.scroll);
  }

  private observe(container: HTMLElement): void {
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', this.measure);
      return;
    }
    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(container);
  }

  private measure = (): void => {
    const rect = this.element.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (rect.width === 0 || rect.height === 0) return;

    this.renderer.resize(rect.width, rect.height, dpr);
    this.glCanvas.width = this.renderer.canvas.width;
    this.glCanvas.height = this.renderer.canvas.height;
    this.glCanvas.style.width = `${rect.width}px`;
    this.glCanvas.style.height = `${rect.height}px`;

    // Force a redraw: the grid changed even if the content did not.
    this.lastRevision = -1;
  };

  private loop = (now = 0): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);

    // Clamped: a backgrounded tab resumes with a huge gap, which would
    // otherwise decay the whole screen to black in one step.
    const elapsed = this.lastFrameAt === 0 ? 16.7 : Math.min(now - this.lastFrameAt, 100);
    this.lastFrameAt = now;

    // Each overlay frame is a fresh buffer, so its own revision restarts and
    // cannot be compared. The serial is what says "a new frame arrived".
    const changed =
      this.buffer.revision !== this.lastRevision ||
      this.scroll !== this.lastScroll ||
      this.overlaySerial !== this.lastOverlaySerial;

    if (changed) {
      this.lastRevision = this.buffer.revision;
      this.lastScroll = this.scroll;
      this.lastOverlaySerial = this.overlaySerial;
      // Phosphor keeps glowing after the last change, so keep drawing until
      // it has faded. Without this the decay freezes mid-fade, leaving a
      // permanent ghost of the previous screen.
      this.settleMs = this.crt ? SETTLE_MS : 0;
      this.draw(elapsed);
      return;
    }

    if (this.settleMs > 0) {
      this.settleMs -= elapsed;
      this.draw(elapsed);
    }
    // Otherwise: nothing changed and nothing is glowing. Skip the frame
    // entirely rather than burning a phone battery redrawing a still image.
  };

  private draw(elapsedMs = 16.7): void {
    // An overlay is always pinned: a full-screen program draws exactly the
    // rows it means to, and scrolling it would be scrolling the wrong thing.
    if (this.overlay) this.renderer.render(this.overlay, 0);
    else this.renderer.render(this.buffer, this.scroll);
    if (this.crt) this.crt.render(this.renderer.canvas, elapsedMs);
    else this.blit();
    this.syncMirror();
  }

  /** Fallback: copy the text canvas straight to the visible one. */
  private blit(): void {
    const ctx = this.glCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(this.renderer.canvas, 0, 0);
  }

  /**
   * Keep the accessibility mirror in step.
   *
   * Only the tail is mirrored: a screen reader announcing two thousand lines
   * of scrollback on every command would be unusable.
   */
  private syncMirror(): void {
    const lines = (this.overlay ?? this.buffer).all();
    const tail = lines.slice(-Math.max(this.renderer.rows, 20));
    const text = tail.map((l) => l.text).join('\n');
    if (this.mirror.textContent !== text) this.mirror.textContent = text;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    window.removeEventListener('resize', this.measure);
    this.crt?.dispose();
  }
}
