import { lex, type Token, type TokenType } from './lexer.js';
import {
  ShellSyntaxError,
  type AndOr,
  type Assignment,
  type Command,
  type Pipeline,
  type Redirect,
  type RedirectOp,
  type Script,
  type Simple,
  type Word,
} from './types.js';

const REDIRECTS: Partial<Record<TokenType, RedirectOp>> = {
  GT: '>',
  DGT: '>>',
  LT: '<',
  REDIR_ERR: '2>',
  REDIR_ERR_APPEND: '2>>',
};

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

export function parse(input: string): Script {
  return new Parser(lex(input)).script();
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private next(): Token {
    return this.tokens[this.pos++]!;
  }

  private at(type: TokenType): boolean {
    return this.peek().type === type;
  }

  /**
   * Step past newlines that cannot end a statement.
   *
   * After `|`, `&&` or `||` a shell keeps reading, which is what lets a long
   * pipeline be written down the page. Everywhere else a newline is a
   * separator as good as `;`.
   */
  private skipNewlines(): void {
    while (this.at('NEWLINE')) this.next();
  }

  script(): Script {
    const statements: AndOr[] = [];
    while (!this.at('EOF')) {
      if (this.at('SEMI') || this.at('AMP') || this.at('NEWLINE')) { this.next(); continue; }
      if (this.at('RPAREN')) break;
      const statement = this.andOr();
      // `cmd &` backgrounds the whole and-or list, not just the last pipeline.
      if (this.at('AMP')) { statement.background = true; this.next(); }
      else if (this.at('SEMI') || this.at('NEWLINE')) this.next();
      statements.push(statement);
    }
    return { type: 'script', statements };
  }

  private andOr(): AndOr {
    const first = this.pipeline();
    const rest: AndOr['rest'] = [];
    while (this.at('AND_IF') || this.at('OR_IF')) {
      const op = this.next().type === 'AND_IF' ? '&&' : '||';
      this.skipNewlines();
      rest.push({ op, pipeline: this.pipeline() });
    }
    return { type: 'andor', first, rest };
  }

  private pipeline(): Pipeline {
    const commands: Simple[] = [this.simple()];
    while (this.at('PIPE')) {
      this.next();
      this.skipNewlines();
      commands.push(this.simple());
    }
    return { type: 'pipeline', commands };
  }

  private simple(): Simple {
    if (this.at('LPAREN')) {
      this.next();
      this.skipNewlines();
      const body = this.script();
      if (!this.at('RPAREN')) throw new ShellSyntaxError("expected ')'");
      this.next();
      return { type: 'subshell', body, redirects: this.redirects() };
    }
    return this.command();
  }

  private redirects(): Redirect[] {
    const out: Redirect[] = [];
    for (;;) {
      const op = REDIRECTS[this.peek().type];
      if (!op) break;
      this.next();
      const target = this.peek();
      if (target.type !== 'WORD' || !target.word) {
        throw new ShellSyntaxError(`expected a filename after '${op}'`);
      }
      this.next();
      out.push({ op, target: target.word });
    }
    return out;
  }

  private command(): Command {
    const assignments: Assignment[] = [];
    const words: Word[] = [];
    const redirects: Redirect[] = [];

    // Leading NAME=value pairs, only before the first real word.
    while (this.at('WORD') && words.length === 0) {
      const tok = this.peek();
      const parts = tok.word!.parts;
      const firstBare = parts[0];
      if (parts.length >= 1 && firstBare?.kind === 'bare') {
        const m = ASSIGNMENT.exec(firstBare.value);
        if (m) {
          this.next();
          const rest = parts.slice(1);
          const head = m[2]!;
          assignments.push({
            name: m[1]!,
            value: { parts: head.length > 0 ? [{ kind: 'bare', value: head }, ...rest] : rest },
          });
          continue;
        }
      }
      break;
    }

    for (;;) {
      redirects.push(...this.redirects());
      if (this.at('WORD')) {
        words.push(this.next().word!);
        continue;
      }
      break;
    }

    if (words.length === 0 && assignments.length === 0 && redirects.length === 0) {
      const tok = this.peek();
      throw new ShellSyntaxError(
        tok.type === 'EOF' ? 'unexpected end of input' : `unexpected token '${tok.text}'`,
      );
    }

    return { type: 'command', assignments, words, redirects };
  }
}
