import { ShellSyntaxError, type Word, type WordPart } from './types.js';

export type TokenType =
  | 'WORD'
  | 'PIPE'
  | 'AND_IF'
  | 'OR_IF'
  | 'AMP'
  | 'SEMI'
  /** End of line. Separates statements, except where an operator wants more. */
  | 'NEWLINE'
  | 'GT'
  | 'DGT'
  | 'LT'
  | 'REDIR_ERR'
  | 'REDIR_ERR_APPEND'
  /** `2>&1` and `>&2`: one stream pointed at wherever the other goes now. */
  | 'DUP_ERR_TO_OUT'
  | 'DUP_OUT_TO_ERR'
  | 'LPAREN'
  | 'RPAREN'
  /** `<<WORD` or `<<-WORD`, with its body attached once the line has ended. */
  | 'HEREDOC'
  | 'EOF';

export interface Heredoc {
  delimiter: string;
  /** A quoted delimiter (`<<'EOF'`) makes the body literal: no `$`, no `$(...)`. */
  quoted: boolean;
  /** `<<-`: leading tabs come off every body line and the delimiter line. */
  strip: boolean;
  body: Word;
}

export interface Token {
  type: TokenType;
  /** Present for WORD. */
  word?: Word;
  /** Present for HEREDOC. */
  heredoc?: Heredoc;
  /**
   * On EOF only: the delimiter of a here-document the input ended inside.
   *
   * Not an error by itself. A script that ends inside one runs with what it
   * has, the way bash does, and an interactive line that ends inside one is a
   * line that wants more input -- the caller decides which this is.
   */
  unterminated?: string;
  /** Raw source text, for error messages. */
  text: string;
}

const OPERATOR_START = new Set(['|', '&', ';', '<', '>', '(', ')']);

/**
 * Scan a `$(...)` body starting at the opening paren, returning the inner
 * source and the index just past the closing paren.
 *
 * Parens nest, and a paren inside quotes is not a delimiter, so this cannot
 * be a simple indexOf.
 */
function scanSubstitution(input: string, start: number): { inner: string; end: number } {
  let depth = 1;
  let i = start + 1;
  let inner = '';
  let quote: "'" | '"' | null = null;

  while (i < input.length) {
    const c = input[i]!;

    if (quote) {
      if (c === '\\' && quote === '"' && i + 1 < input.length) {
        inner += c + input[i + 1]!;
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      inner += c;
      i++;
      continue;
    }

    if (c === "'" || c === '"') { quote = c; inner += c; i++; continue; }
    if (c === '\\' && i + 1 < input.length) { inner += c + input[i + 1]!; i += 2; continue; }
    if (c === '(') depth++;
    if (c === ')') {
      depth--;
      if (depth === 0) return { inner, end: i + 1 };
    }
    inner += c;
    i++;
  }

  throw new ShellSyntaxError('unterminated command substitution: missing )');
}

/** Scan a legacy backtick substitution. No nesting; a backslash escapes. */
function scanBacktick(input: string, start: number): { inner: string; end: number } {
  let i = start + 1;
  let inner = '';
  while (i < input.length) {
    const c = input[i]!;
    if (c === '\\' && i + 1 < input.length) { inner += input[i + 1]!; i += 2; continue; }
    if (c === '`') return { inner, end: i + 1 };
    inner += c;
    i++;
  }
  throw new ShellSyntaxError('unterminated command substitution: missing `');
}

/**
 * The parts of an unquoted here-document body.
 *
 * Expanded the way double quotes are -- `$VAR`, `$(...)` and backticks -- with
 * two differences that are the point of a heredoc: a `"` is just a character,
 * and the newlines are the content. An escaped `$`, backtick or backslash
 * becomes a single-quoted part, so expansion can never reach it.
 */
function heredocParts(body: string): WordPart[] {
  const parts: WordPart[] = [];
  let text = '';
  const flush = (): void => {
    if (text.length > 0) { parts.push({ kind: 'dquoted', value: text }); text = ''; }
  };
  let i = 0;
  while (i < body.length) {
    const c = body[i]!;
    const next = body[i + 1] ?? '';
    if (c === '\\' && (next === '$' || next === '`' || next === '\\')) {
      flush();
      parts.push({ kind: 'squoted', value: next });
      i += 2;
      continue;
    }
    if (c === '\\' && next === '\n') { i += 2; continue; }
    if (c === '$' && next === '(') {
      flush();
      const sub = scanSubstitution(body, i + 1);
      parts.push({ kind: 'subst', value: sub.inner, quoted: true });
      i = sub.end;
      continue;
    }
    if (c === '`') {
      flush();
      const sub = scanBacktick(body, i);
      parts.push({ kind: 'subst', value: sub.inner, quoted: true });
      i = sub.end;
      continue;
    }
    text += c;
    i++;
  }
  flush();
  return parts;
}

/** The delimiter as the shell compares it: quotes and backslashes removed. */
function delimiterOf(parts: readonly WordPart[]): string {
  return parts.map((part) => part.value).join('');
}

/**
 * Tokenise a command line.
 *
 * Quoting is preserved structurally rather than stripped here, so that
 * expansion can tell `*.txt` (glob) from `'*.txt'` (literal) later.
 */
export function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const peek = (off = 0): string => input[i + off] ?? '';

  /** Here-documents opened on the current line, waiting for it to end. */
  const pending: Token[] = [];
  let unterminated: string | undefined;

  /*
   * Read the bodies of every here-document opened on the line that just
   * ended, in order, each up to its delimiter line. Running out of input
   * before a delimiter is recorded rather than thrown -- see `unterminated`.
   */
  const readBodies = (): void => {
    for (const token of pending) {
      const spec = token.heredoc!;
      let body = '';
      let closed = false;
      while (i < input.length) {
        const nl = input.indexOf('\n', i);
        const end = nl === -1 ? input.length : nl;
        let line = input.slice(i, end);
        i = nl === -1 ? input.length : nl + 1;
        if (spec.strip) line = line.replace(/^\t+/, '');
        if (line === spec.delimiter) { closed = true; break; }
        body += `${line}\n`;
      }
      if (!closed) unterminated ??= spec.delimiter;
      spec.body = { parts: spec.quoted ? [{ kind: 'squoted', value: body }] : heredocParts(body) };
    }
    pending.length = 0;
  };

  /** A word: accumulate until unquoted whitespace or an operator. */
  function readWord(): { parts: WordPart[]; raw: string } {
    const parts: WordPart[] = [];
    let bare = '';
    let raw = '';

    const flushBare = (): void => {
      if (bare.length > 0) { parts.push({ kind: 'bare', value: bare }); bare = ''; }
    };

    while (i < input.length) {
      const ch = peek();

      if (ch === ' ' || ch === '\t' || ch === '\n') break;
      if (OPERATOR_START.has(ch)) break;
      if (ch === '2' && peek(1) === '>' && bare.length === 0 && parts.length === 0) break;

      if (ch === '\\') {
        const next = peek(1);
        if (next === '') throw new ShellSyntaxError('unexpected end of input after \\');
        // Line continuation: the backslash and the newline both disappear, and
        // the word carries on across the break.
        if (next === '\n') { i += 2; raw += ch + next; continue; }
        bare += next;
        raw += ch + next;
        i += 2;
        continue;
      }

      if (ch === '$' && peek(1) === '(') {
        flushBare();
        const { inner, end } = scanSubstitution(input, i + 1);
        parts.push({ kind: 'subst', value: inner, quoted: false });
        raw += input.slice(i, end);
        i = end;
        continue;
      }

      if (ch === '`') {
        flushBare();
        const { inner, end } = scanBacktick(input, i);
        parts.push({ kind: 'subst', value: inner, quoted: false });
        raw += input.slice(i, end);
        i = end;
        continue;
      }

      if (ch === "'") {
        flushBare();
        i++; raw += ch;
        let value = '';
        while (i < input.length && peek() !== "'") { value += peek(); raw += peek(); i++; }
        if (i >= input.length) throw new ShellSyntaxError('unterminated single quote');
        raw += peek();
        i++;
        parts.push({ kind: 'squoted', value });
        continue;
      }

      if (ch === '"') {
        flushBare();
        i++; raw += ch;
        let value = '';
        const flushQuoted = (): void => {
          if (value.length > 0) { parts.push({ kind: 'dquoted', value }); value = ''; }
        };
        while (i < input.length && peek() !== '"') {
          if (peek() === '$' && peek(1) === '(') {
            flushQuoted();
            const sub = scanSubstitution(input, i + 1);
            parts.push({ kind: 'subst', value: sub.inner, quoted: true });
            raw += input.slice(i, sub.end);
            i = sub.end;
            continue;
          }
          if (peek() === '`') {
            flushQuoted();
            const sub = scanBacktick(input, i);
            parts.push({ kind: 'subst', value: sub.inner, quoted: true });
            raw += input.slice(i, sub.end);
            i = sub.end;
            continue;
          }
          if (peek() === '\\') {
            const next = peek(1);
            // Inside double quotes, backslash only escapes these.
            if (next === '"' || next === '\\' || next === '$' || next === '`') {
              value += next; raw += peek() + next; i += 2; continue;
            }
          }
          value += peek(); raw += peek(); i++;
        }
        if (i >= input.length) throw new ShellSyntaxError('unterminated double quote');
        raw += peek();
        i++;
        flushQuoted();
        // A genuinely empty "" still has to produce an empty argument.
        if (parts.length === 0) parts.push({ kind: 'dquoted', value: '' });
        continue;
      }

      bare += ch;
      raw += ch;
      i++;
    }

    flushBare();
    return { parts, raw };
  }

  while (i < input.length) {
    const c = peek();

    // A backslash at end of line joins it to the next one, which is how any
    // script longer than eighty columns is written.
    if (c === '\\' && peek(1) === '\n') {
      i += 2;
      continue;
    }

    if (c === '\n') {
      tokens.push({ type: 'NEWLINE', text: '\n' });
      i++;
      readBodies();
      continue;
    }

    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }

    if (c === '#') {
      while (i < input.length && peek() !== '\n') i++;
      continue;
    }

    // 2>&1, 1>&2 and >&2. Spelled out rather than parsed as a general
    // descriptor syntax: these two are what every real script uses, and a
    // shell that rejects them rejects the first thing people paste.
    if (c === '2' && peek(1) === '>' && peek(2) === '&' && peek(3) === '1') {
      tokens.push({ type: 'DUP_ERR_TO_OUT', text: '2>&1' });
      i += 4;
      continue;
    }
    if (c === '1' && peek(1) === '>' && peek(2) === '&' && peek(3) === '2') {
      tokens.push({ type: 'DUP_OUT_TO_ERR', text: '1>&2' });
      i += 4;
      continue;
    }
    if (c === '>' && peek(1) === '&' && peek(2) === '2') {
      tokens.push({ type: 'DUP_OUT_TO_ERR', text: '>&2' });
      i += 3;
      continue;
    }

    // 2>> and 2>
    if (c === '2' && peek(1) === '>') {
      if (peek(2) === '>') {
        tokens.push({ type: 'REDIR_ERR_APPEND', text: '2>>' });
        i += 3;
      } else {
        tokens.push({ type: 'REDIR_ERR', text: '2>' });
        i += 2;
      }
      continue;
    }

    if (OPERATOR_START.has(c)) {
      if (c === '|' && peek(1) === '|') { tokens.push({ type: 'OR_IF', text: '||' }); i += 2; continue; }
      if (c === '|') { tokens.push({ type: 'PIPE', text: '|' }); i += 1; continue; }
      if (c === '&' && peek(1) === '&') { tokens.push({ type: 'AND_IF', text: '&&' }); i += 2; continue; }
      if (c === '&') { tokens.push({ type: 'AMP', text: '&' }); i += 1; continue; }
      if (c === ';') { tokens.push({ type: 'SEMI', text: ';' }); i += 1; continue; }
      if (c === '>' && peek(1) === '>') { tokens.push({ type: 'DGT', text: '>>' }); i += 2; continue; }
      if (c === '>') { tokens.push({ type: 'GT', text: '>' }); i += 1; continue; }
      if (c === '<' && peek(1) === '<') {
        const strip = peek(2) === '-';
        i += strip ? 3 : 2;
        while (peek() === ' ' || peek() === '\t') i++;
        const { parts, raw } = readWord();
        if (parts.length === 0) throw new ShellSyntaxError(`expected a delimiter after '<<${strip ? '-' : ''}'`);
        const quoted = parts.some((part) => part.kind !== 'bare') || raw.includes('\\');
        const token: Token = {
          type: 'HEREDOC',
          text: `<<${strip ? '-' : ''}${raw}`,
          heredoc: { delimiter: delimiterOf(parts), quoted, strip, body: { parts: [] } },
        };
        tokens.push(token);
        pending.push(token);
        continue;
      }
      if (c === '<') { tokens.push({ type: 'LT', text: '<' }); i += 1; continue; }
      if (c === '(') { tokens.push({ type: 'LPAREN', text: '(' }); i += 1; continue; }
      if (c === ')') { tokens.push({ type: 'RPAREN', text: ')' }); i += 1; continue; }
    }

    const { parts, raw } = readWord();
    tokens.push({ type: 'WORD', word: { parts }, text: raw });
  }

  // A line that ends without a newline still owes its here-documents a body.
  if (pending.length > 0) readBodies();
  tokens.push({ type: 'EOF', text: '', ...(unterminated !== undefined ? { unterminated } : {}) });
  return tokens;
}
