import { ShellSyntaxError, type Word, type WordPart } from './types.js';

export type TokenType =
  | 'WORD'
  | 'PIPE'
  | 'AND_IF'
  | 'OR_IF'
  | 'SEMI'
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

    if (c === ' ' || c === '\t' || c === '\n') {
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
      if (c === '&') throw new ShellSyntaxError('background jobs (&) are not supported yet');
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
        bare += next;
        raw += ch + next;
        i += 2;
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
        while (i < input.length && peek() !== '"') {
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
        parts.push({ kind: 'dquoted', value });
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
