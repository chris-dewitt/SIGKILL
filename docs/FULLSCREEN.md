# Full-screen programs

How `vi` takes over the screen, and what to do to add another one (a pager, a
hex viewer, a process monitor). `packages/editor` is the worked example.

---

## The seam, and why it is shaped like this

`packages/machine` has no dependencies and no screen. It must not grow either.
So a full-screen command does not draw: it hands the host a **program** and
returns immediately.

```ts
// in the command
ctx.screenRequest = new ViEditor(text, { rows, cols, path, readOnly });
return 0;
```

```ts
// in the host, after exec
const result = await machine.exec(command);
if (result.screen) enterScreen(result.screen);
```

This is the same pattern as `clearRequested`: the Machine raises a flag that
says what is wanted, and the host decides what that means on its particular
screen. A `ScreenProgram` is declared structurally in `machine`, so the Machine
knows a full-screen thing can exist without importing one.

**A Machine with no screen never drives the program.** That is deliberate and
tested: `vi` inside a cron job or a test is a no-op that returns 0, not a hang.

## The contract

```ts
interface ScreenProgram {
  readonly name: string;
  readonly path: string;          // the host owns the disk, so it needs this
  key(k: { key: string; ctrl?: boolean }): void;
  frame(): Array<{ text: string; kind: LineKind; cursor?: number }>;
  resize(rows: number, cols: number): void;
  readonly exit: { write: boolean; text: string; message?: string } | null;
  readonly chips: readonly string[];
  pendingWrite?: string | undefined;
}
```

Keys in, frames out. **No DOM, no canvas, no async.** That is what makes every
keystroke in vi unit-testable: `test/vi.test.ts` types `'jdd:wq<Enter>'` at it
and reads the buffer back, with no browser anywhere.

`frame()` returns exactly the rows the screen has. The program is told the real
column count and **truncates to it**, so no line ever wraps — which is what
makes the `cursor` column map exactly onto one cell.

`user` is who launched it, **captured at launch and copied**. `sudo` swaps
`ctx.user` for one command and restores it in a `finally`, so a program that
reads the shell's user when the player finally presses `:w` sees the
unprivileged one — `sudo vi /etc/hosts` then opens writable and throws the work
away at the end. The host writes as `program.user`.

`pendingWrite` is `:w` without quitting. The host applies it and clears the
field, so a save reaches the disk the moment it is typed rather than whenever
the program happens to close.

## Drawing

`TerminalView.showScreen(lines)` puts a frame up as an **overlay**. The
scrollback is not touched, so leaving the editor puts the player back exactly
where they were — which is what a real terminal does, and the reason this is an
overlay and not a `clear`.

The cursor is a real reverse-video cell: the renderer fills a block in the
line's colour and draws the glyph out of it in the background colour, using one
extra atlas sheet tinted to the background. One cell, one draw call.

## The phone

This is the part most terminal-on-mobile attempts get wrong, so it is worth
stating plainly.

**`chips` is the answer to Escape.** The program names the keys worth showing
for its current mode; the app renders them into the chip bar. In vi's normal
mode that is `i ESC :w :wq dd u x o $ 0`; in insert mode it collapses to
`ESC ← → ↑ ↓`.

**A label is not keystrokes.** `chipKeystrokes(label)` in
`packages/editor/src/chips.ts` does that translation, and it lives in the
package rather than the app so it can be tested without a browser. It knows
that `^O` is Ctrl-O and not a caret and an O, and that `:wq` needs an Enter on
the end or the editor just sits in command mode with the text typed. Both of
those shipped broken once.

**An on-screen key must never take focus.** The chip bar is rebuilt on every
keystroke, so a tapped button stops existing mid-gesture, focus falls to
`<body>` and the soft keyboard closes — after which everything typed is
silently lost. Every on-screen key calls `preventDefault` on `pointerdown`, and
the tap handler refocuses the input afterwards as well.

**The text input stays in the document, full size, and focused.** Its text and
caret go transparent; it is never `hidden` and never shrunk to a pixel. Hiding
it dismisses the soft keyboard, and a 1px fully transparent input is exactly
the shape mobile browsers decline to raise a keyboard for — either way a phone
player can tap chips but cannot type a single character. The cursor they watch
is the block the renderer draws, not the field's caret.

**Two input paths, because soft keyboards lie.** `keydown` handles named keys,
control combos and printable characters from a physical keyboard. Many Android
keyboards report `Unidentified` for keydown and only tell the truth through an
`input` event, so whatever lands in the field is forwarded a character at a time
and the field is emptied again.

## Adding one

1. Write the program as a pure state machine implementing `FullscreenProgram`.
   Put the *text* handling in `TextBuffer` if it is editing anything — `vi` and
   `nano` share it, which is why `dd` and `^K` cannot disagree about what
   deleting a line means.
2. Give it a `chips` list per mode. If a key is required to escape it, that key
   must be in the list.
3. Register a `CommandSpec` that checks permissions **before** opening (see
   `inspect` in `commands.ts`: finding out at `:w` that a directory is
   unwritable is how people lose work) and sets `ctx.screenRequest`.
4. Test it by typing at it. `test/keys.ts` turns `'ihi<Escape>:wq<Enter>'` into
   keystrokes, so a test reads like a session.
5. **Drive it in a real browser on a touch viewport before believing it.** The
   editor is pure and has 118 unit tests, and they could not see any of the
   three focus-and-chip bugs above, because those live in the glue. Chromium
   and Playwright are available in the cloud session
   (`/opt/pw-browsers/chromium-1194`): serve `apps/terminal/dist`, open it with
   `hasTouch: true`, tap the chips, and read `#screen`'s live-region mirror for
   assertions without needing pixels.
6. Test the round trip through a real `Machine` too — `test/commands.test.ts`
   drives the program and then asserts `grep` sees the change. `applyWrite` and
   `flushPendingWrite` are exported for exactly that, so the app and the tests
   share one save path instead of two copies.
