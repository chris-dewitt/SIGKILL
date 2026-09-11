/**
 * Phosphor CRT renderer — Phase 2.
 *
 * For now the terminal app styles itself with CSS. This package exists to stake
 * the boundary: when the glyph-atlas canvas renderer and the WebGL post-pass
 * land, they land here, and `apps/terminal` consumes them through this entry
 * point rather than growing its own renderer.
 */
export const PHASE = 2 as const;
