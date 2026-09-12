/** A keystroke, named the way a browser names it but with no DOM types. */
export interface EditorKey {
  /** A single character, or a name: Escape, Enter, Backspace, Tab, ArrowUp... */
  key: string;
  ctrl?: boolean;
}

export type FrameKind = 'out' | 'err' | 'echo' | 'system';

export interface FrameLine {
  text: string;
  kind: FrameKind;
  /** Column to draw the block cursor on, if it is on this line. */
  cursor?: number;
}

/** What the editor asked the shell to do when it closed. */
export interface EditorExit {
  /** Write the buffer back to the file. */
  write: boolean;
  text: string;
  /** Printed by the shell after the editor closes, if anything needs saying. */
  message?: string;
}

export interface EditorOptions {
  rows: number;
  cols: number;
  /**
   * The user the editor is running as.
   *
   * Captured when the command runs, not read back later: under `sudo` the
   * shell's user reverts the moment the command returns, and the editor
   * outlives that by design.
   */
  user?: { uid: number; gid: number; name: string };
  /** Shown in the status line and in messages. */
  path: string;
  /** True when the file exists but the player cannot write it. */
  readOnly?: boolean;
  /** True when the path does not exist yet, which vi announces. */
  isNew?: boolean;
}

/**
 * The contract the shell and the app drive an editor through.
 *
 * Deliberately narrow and deliberately synchronous: keys in, frames out, and
 * an exit when it is over. Nothing here knows about canvases or DOM events,
 * which is why the whole editor is unit-testable without a browser.
 */
export interface FullscreenProgram {
  readonly name: string;
  /** Absolute path being edited. The host owns the disk, so it needs this. */
  readonly path: string;
  /** Who launched it. Captured at launch because `sudo` only lasts one command. */
  readonly user: { uid: number; gid: number; name: string };
  key(k: EditorKey): void;
  frame(): FrameLine[];
  resize(rows: number, cols: number): void;
  /** Non-null once the program is finished. */
  readonly exit: EditorExit | null;
  /**
   * Keys worth offering as on-screen buttons right now.
   *
   * This is the whole answer to "how do you press Escape on a phone": the app
   * renders these into the chip bar, and they change with the mode.
   */
  readonly chips: readonly string[];
  /** Show a message from the host -- typically a write the disk refused. */
  notify?(message: string): void;
}
