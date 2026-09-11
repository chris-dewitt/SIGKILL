/** A word is built from parts so expansion knows what was quoted. */
export type WordPart =
  | { kind: 'bare'; value: string }      // expand vars, then glob + split
  | { kind: 'dquoted'; value: string }   // expand vars, no glob, no split
  | { kind: 'squoted'; value: string }   // literal, nothing happens
  // $(...) or `...`. `value` is the inner source, run at expansion time.
  // Quoted substitutions skip splitting and globbing, same as "$var".
  | { kind: 'subst'; value: string; quoted: boolean };

export interface Word {
  parts: WordPart[];
}

export type RedirectOp = '>' | '>>' | '<' | '2>' | '2>>';

export interface Redirect {
  op: RedirectOp;
  target: Word;
}

export interface Assignment {
  name: string;
  value: Word;
}

export interface Command {
  type: 'command';
  assignments: Assignment[];
  words: Word[];
  redirects: Redirect[];
}

export interface Subshell {
  type: 'subshell';
  body: Script;
  redirects: Redirect[];
}

export type Simple = Command | Subshell;

export interface Pipeline {
  type: 'pipeline';
  commands: Simple[];
}

export interface AndOr {
  type: 'andor';
  first: Pipeline;
  rest: Array<{ op: '&&' | '||'; pipeline: Pipeline }>;
}

export interface Script {
  type: 'script';
  statements: AndOr[];
}

export class ShellSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellSyntaxError';
  }
}
