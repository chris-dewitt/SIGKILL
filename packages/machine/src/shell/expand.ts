import * as p from '../vfs/path.js';
import type { Vfs } from '../vfs/vfs.js';
import type { User } from '../vfs/types.js';
import type { Word } from './types.js';

export interface ExpandContext {
  env: Record<string, string>;
  cwd: string;
  home: string;
  vfs: Vfs;
  user: User;
  /** Last exit status, for $?. */
  status: number;
}

/**
 * Expand one word into zero or more arguments.
 *
 * Order matches a real shell closely enough to be honest: tilde, then
 * parameters, then field splitting, then globbing. Quoted parts opt out of
 * the later stages, which is the whole reason quoting exists.
 */
export function expandWord(word: Word, ctx: ExpandContext): string[] {
  interface Piece { text: string; glob: boolean; split: boolean }
  const pieces: Piece[] = [];

  for (const [idx, part] of word.parts.entries()) {
    if (part.kind === 'squoted') {
      pieces.push({ text: part.value, glob: false, split: false });
      continue;
    }
    let text = part.value;
    if (part.kind === 'bare' && idx === 0) text = expandTilde(text, ctx);
    text = expandParams(text, ctx);
    pieces.push({
      text,
      glob: part.kind === 'bare',
      split: part.kind === 'bare',
    });
  }

  // An entirely empty unquoted word disappears; a quoted empty one survives.
  if (pieces.length === 0) return [];

  // Field splitting: only across pieces that allow it.
  let fields: Array<{ text: string; glob: boolean }> = [{ text: '', glob: false }];
  for (const piece of pieces) {
    if (!piece.split) {
      const last = fields[fields.length - 1]!;
      last.text += piece.text;
      continue;
    }
    const chunks = piece.text.split(/[ \t\n]+/);
    for (const [ci, chunk] of chunks.entries()) {
      if (ci === 0) {
        const last = fields[fields.length - 1]!;
        last.text += chunk;
        last.glob = last.glob || piece.glob;
      } else {
        fields.push({ text: chunk, glob: piece.glob });
      }
    }
  }

  fields = fields.filter((f, i) => f.text.length > 0 || (i === 0 && pieces.some((x) => !x.split)));

  const out: string[] = [];
  for (const field of fields) {
    if (field.glob && /[*?[]/.test(field.text)) {
      const matches = glob(field.text, ctx);
      if (matches.length > 0) { out.push(...matches); continue; }
    }
    out.push(field.text);
  }
  return out;
}

export function expandWords(words: Word[], ctx: ExpandContext): string[] {
  return words.flatMap((w) => expandWord(w, ctx));
}

function expandTilde(text: string, ctx: ExpandContext): string {
  if (text === '~') return ctx.home;
  if (text.startsWith('~/')) return ctx.home + text.slice(1);
  return text;
}

const PARAM = /\$(\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*)|\?|\$)/g;

function expandParams(text: string, ctx: ExpandContext): string {
  return text.replace(PARAM, (_m, _braced, braceName, bareName) => {
    if (_m === '$?') return String(ctx.status);
    if (_m === '$$') return '1';
    const name = (braceName ?? bareName) as string;
    return ctx.env[name] ?? '';
  });
}

/** Translate a shell glob into a regex anchored to a single path component. */
export function globToRegExp(pattern: string): RegExp {
  let out = '^';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === '*') { out += '[^/]*'; i++; continue; }
    if (c === '?') { out += '[^/]'; i++; continue; }
    if (c === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close < 0) { out += '\\['; i++; continue; }
      let set = pattern.slice(i + 1, close);
      let negate = false;
      if (set.startsWith('!') || set.startsWith('^')) { negate = true; set = set.slice(1); }
      out += `[${negate ? '^' : ''}${set.replace(/\\/g, '\\\\')}]`;
      i = close + 1;
      continue;
    }
    out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    i++;
  }
  return new RegExp(out + '$');
}

function glob(pattern: string, ctx: ExpandContext): string[] {
  const absolute = pattern.startsWith('/');
  const segments = pattern.split('/').filter((s) => s.length > 0);
  let current: string[] = [absolute ? '/' : '.'];

  for (const segment of segments) {
    const next: string[] = [];
    const isPattern = /[*?[]/.test(segment);

    for (const base of current) {
      if (!isPattern) {
        const candidate = p.join(base, segment);
        if (ctx.vfs.exists(p.resolve(ctx.cwd, candidate), ctx.user)) next.push(candidate);
        continue;
      }
      let entries: string[];
      try {
        entries = ctx.vfs.readdir(p.resolve(ctx.cwd, base), ctx.user);
      } catch {
        continue;
      }
      const re = globToRegExp(segment);
      for (const entry of entries) {
        // Leading dots are only matched by an explicit leading dot, as in sh.
        if (entry.startsWith('.') && !segment.startsWith('.')) continue;
        if (re.test(entry)) next.push(p.join(base, entry));
      }
    }
    current = next;
    if (current.length === 0) return [];
  }

  return current
    .map((c) => (c.startsWith('./') ? c.slice(2) : c))
    .sort();
}
