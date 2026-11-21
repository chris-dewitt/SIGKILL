/**
 * What could come next in a SQL statement, for a player tapping rather than
 * typing.
 *
 * Not a parser. A statement half-written on a phone is not valid SQL yet, and
 * the question is never "what does this mean" but "what is the next sensible
 * word". So this reads the last keyword it can see and offers what usually
 * follows it, with the real table and column names filled in from the
 * database itself. That covers every query the games ask for -- SELECT,
 * WHERE, JOIN, GROUP BY, ORDER BY, LIMIT -- and anything it does not know it
 * simply offers nothing for, which costs a player a keystroke, not a wrong
 * word.
 *
 * Pure: a schema and a string in, words out.
 */

export interface Schema {
  /** Table name -> its columns, in declaration order. */
  readonly tables: ReadonlyMap<string, readonly string[]>;
}

/**
 * The schema, read from the database file's own bytes.
 *
 * SQLite keeps every `CREATE TABLE` statement as plain text in the file, so
 * the names can be lifted without an engine: no worker, no wasm, nothing
 * asynchronous standing between a keypress and the chips.
 */
export function schemaOf(text: string): Schema {
  const tables = new Map<string, string[]>();
  const head = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?(\w+)["`]?\s*\(/gi;
  for (const match of text.matchAll(head)) {
    const name = match[1]!;
    if (name.startsWith('sqlite_') || tables.has(name)) continue;
    // To the matching bracket, not the first one: `VARCHAR(20)` and
    // `PRIMARY KEY (a)` live inside the definition. In the file the statement
    // is followed by binary record bytes, not a semicolon.
    let depth = 1;
    let end = match.index! + match[0].length;
    for (; end < text.length && depth > 0; end++) {
      if (text[end] === '(') depth++;
      else if (text[end] === ')') depth--;
    }
    if (depth !== 0) continue;
    const body = text.slice(match.index! + match[0].length, end - 1);
    const parts: string[] = [];
    let level = 0;
    let current = '';
    for (const ch of body) {
      if (ch === '(') level++;
      if (ch === ')') level--;
      if (ch === ',' && level === 0) {
        parts.push(current);
        current = '';
      } else current += ch;
    }
    parts.push(current);
    const columns = parts
      .map((part) => part.trim().split(/\s+/)[0] ?? '')
      .map((col) => col.replace(/["`]/g, ''))
      .filter((col) => /^\w+$/.test(col) && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(col));
    tables.set(name, columns);
  }
  return { tables };
}

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'JOIN', 'LEFT', 'ON', 'GROUP', 'ORDER', 'BY', 'LIMIT',
  'DESC', 'ASC', 'LIKE', 'IS', 'NOT', 'NULL', 'IN', 'AS', 'DISTINCT', 'INSERT', 'INTO', 'VALUES',
]);

/** After a complete clause, what could end or extend the statement. */
const AFTER_TABLE = ['WHERE', 'JOIN', 'LEFT JOIN', 'GROUP BY', 'ORDER BY', 'LIMIT', ';"'];

/**
 * The next words.
 *
 * `statement` is everything typed inside the quotes so far, up to but not
 * including the word being typed now.
 */
export function sqlNext(schema: Schema, statement: string): string[] {
  const words = statement.replace(/^["']/, '').match(/\(\*\)|[\w.*()']+|[=<>,]+/g) ?? [];
  const upper = words.map((w) => w.toUpperCase());
  const last = upper[upper.length - 1];
  const tableNames = [...schema.tables.keys()];

  // Tables named after FROM or JOIN, and any alias that follows each one.
  const used: { table: string; alias?: string }[] = [];
  for (let i = 0; i < upper.length; i++) {
    if ((upper[i] === 'FROM' || upper[i] === 'JOIN') && words[i + 1] && schema.tables.has(words[i + 1]!)) {
      const next = words[i + 2];
      const alias = next !== undefined && !KEYWORDS.has(next.toUpperCase()) && /^\w+$/.test(next) ? next : undefined;
      used.push({ table: words[i + 1]!, ...(alias ? { alias } : {}) });
    }
  }
  const columnsOf = (tables: { table: string; alias?: string }[]): string[] =>
    [...new Set(tables.flatMap(({ table, alias }) => (schema.tables.get(table) ?? []).map((c) => (alias ? `${alias}.${c}` : c))))];
  const inScope = used.length > 0 ? columnsOf(used) : columnsOf(tableNames.map((table) => ({ table })));
  const isColumn = (w: string | undefined): boolean =>
    w !== undefined && inScope.some((c) => c.toUpperCase() === w || c.toUpperCase().endsWith(`.${w}`));

  if (last === undefined) return ['SELECT'];

  const seen = (k: string): boolean => upper.includes(k);
  const prev = upper[upper.length - 2];

  // The select list.
  if (!seen('FROM') && (last === 'SELECT' || last === ',' || last === 'DISTINCT')) {
    return last === 'SELECT' ? ['*', 'count(*)', ...inScope] : inScope;
  }
  if (!seen('FROM') && seen('SELECT')) return ['FROM', ','];

  if (last === 'FROM' || last === 'JOIN') return tableNames;
  if (last === 'LEFT') return ['JOIN'];

  // Straight after a table name, or its alias.
  const lastIsTable = schema.tables.has(words[words.length - 1]!);
  const lastIsAlias = used.some((u) => u.alias === words[words.length - 1]);
  if (lastIsTable || lastIsAlias) {
    return prev === 'JOIN' || upper[upper.length - 3] === 'JOIN' ? ['ON'] : AFTER_TABLE;
  }

  if (['WHERE', 'AND', 'OR', 'ON', 'BY'].includes(last)) return inScope;

  if (isColumn(last)) {
    if (upper.slice(-3).includes('BY')) return prev === 'ORDER' || upper.slice(-3).includes('ORDER') ? ['DESC', 'LIMIT', ';"'] : ['ORDER BY', 'LIMIT', ';"'];
    return ['=', 'LIKE', 'IS NULL', '>', '<'];
  }
  if (last === 'DESC' || last === 'ASC') return ['LIMIT', ';"'];
  if (last === 'LIMIT') return ['1', '5', '10'];
  if (/^[=<>]+$/.test(last) || last === 'LIKE') return [];
  if (last === 'IS') return ['NULL', 'NOT NULL'];

  // A value, a number, a closed condition: carry on or finish.
  return ['AND', 'ORDER BY', 'GROUP BY', 'LIMIT', ';"'];
}
