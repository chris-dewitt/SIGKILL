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
  | 'LPAREN'
  | 'RPAREN'
  | 'EOF';

export interface Token {
  type: TokenType;
  /** Present for WORD. */
  word?: Word;
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
 * Tokenise a command line.
 *
 * Quoting is preserved structurally rather than stripped here, so that
 * expansion can tell `*.txt` (glob) from `'*.txt'` (literal) later.
 */
export function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const peek = (off = 0): string => input[i + off] ?? '';

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
      if (c === '<') { tokens.push({ type: 'LT', text: '<' }); i += 1; continue; }
      if (c === '(') { tokens.push({ type: 'LPAREN', text: '(' }); i += 1; continue; }
      if (c === ')') { tokens.push({ type: 'RPAREN', text: ')' }); i += 1; continue; }
    }

    // A word: accumulate until unquoted whitespace or an operator.
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
    tokens.push({ type: 'WORD', word: { parts }, text: raw });
  }

  tokens.push({ type: 'EOF', text: '' });
  return tokens;
}
