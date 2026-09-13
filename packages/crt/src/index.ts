export { TerminalBuffer, wrap, wrapChunks, spansFor, LINE_KINDS } from './buffer.js';
export type { Line, LineKind, Row, Span, Chunk, BufferOptions } from './buffer.js';

export { TerminalRenderer, PHOSPHOR } from './renderer.js';
export type { Palette, RendererOptions } from './renderer.js';

export { GlyphAtlas, measureCell, scaleFont } from './atlas.js';
export type { AtlasOptions } from './atlas.js';

export { CrtPass } from './crt.js';
export type { CrtOptions } from './crt.js';

export { highlight } from './highlight.js';
export type { HighlightOptions } from './highlight.js';

export { TerminalView } from './view.js';
export type { ViewOptions } from './view.js';

export {
  MIN_COLS,
  MIN_ROWS,
  gridFor,
  backingSize,
  visibleRange,
  atBottom,
  atlasCodepoints,
  atlasColumns,
  slotPosition,
} from './metrics.js';
export type { CellSize, GridSize, Viewport } from './metrics.js';
