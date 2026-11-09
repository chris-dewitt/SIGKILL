/**
 * Reading a context the way a model with no instruction hierarchy reads it.
 *
 * This file is the whole of the finale's security lesson, so it is worth
 * saying plainly what it models and what it does not.
 *
 * A language model receives one stream of tokens. Its system prompt, the
 * skills it loaded, the document it was asked to summarise and the reply a
 * tool gave it all arrive in that stream, and nothing in the stream marks which
 * parts are orders and which are material. Some models are trained to prefer
 * the system prompt when the two disagree. Many are not, and the ones that are
 * can still be talked round -- which is why "better-trained models resist this
 * more often" is true and is not a security property.
 *
 * So the reader below does exactly one thing. It finds every line, from any
 * segment of the context, that is addressed to the agent and begins with a verb
 * one of its tools answers to, and it treats that line as an instruction. It
 * does not ask where the line came from. That is the bug, and it is the bug
 * because it is faithful: an exhibit that says "clerk: withdraw ..." looks,
 * to this reader, exactly like a system prompt that says the same thing.
 *
 * The provenance is still recorded -- every instruction carries its source,
 * its owner and its line -- because the transcript is the glass box. The model
 * ignores where an instruction came from; the person reading the transcript
 * should not.
 */

/** One piece of what the agent was given to read, and where it came from. */
export interface Segment {
  /** A path, or `system` for the prompt itself. */
  readonly source: string;
  /** The account that wrote it -- the file's owner, by name. */
  readonly owner: string;
  readonly text: string;
}

/** A line the agent took as an order. */
export interface Instruction {
  readonly tool: string;
  /** The word that matched, as written. */
  readonly verb: string;
  /** Everything after the verb, up to the end of its sentence. */
  readonly arg: string;
  readonly source: string;
  readonly owner: string;
  /** One-based, as an editor counts. */
  readonly line: number;
  /** The whole line, trimmed, as it appeared. */
  readonly text: string;
}

/** Quote marks, bullets and comment leaders a line may be wearing. */
const LEADERS = /^[\s>#*\-"'`|]+/;

/**
 * Every instruction in a segment.
 *
 * `addressedAs` are the phrases that make a line be *to* this agent: its name,
 * and the boilerplate an automated system has learned means "this part is for
 * you". `verbs` maps each word a tool answers to onto that tool's name.
 */
export function findInstructions(
  segment: Segment,
  addressedAs: readonly string[],
  verbs: ReadonlyMap<string, string>,
): Instruction[] {
  const found: Instruction[] = [];
  const names = [...addressedAs].sort((a, b) => b.length - a.length).map(escape);
  const addressed = new RegExp(`^(?:${names.join('|')})\\s*[:,]\\s*(.+)$`, 'i');

  for (const [index, raw] of segment.text.split('\n').entries()) {
    const line = raw.replace(LEADERS, '').trim();
    const match = addressed.exec(line);
    if (!match) continue;

    const rest = match[1]!.replace(/^please\s+/i, '');
    const verb = /^[a-z]+/i.exec(rest)?.[0] ?? '';
    const tool = verbs.get(verb.toLowerCase());
    if (tool === undefined) continue;

    found.push({
      tool,
      verb,
      arg: sentence(rest.slice(verb.length)),
      source: segment.source,
      owner: segment.owner,
      line: index + 1,
      text: line,
    });
  }
  return found;
}

/** Up to the end of the first sentence, without its full stop. */
function sentence(text: string): string {
  const cut = text.search(/;|\.(\s|$)/);
  return (cut < 0 ? text : text.slice(0, cut)).trim();
}

const escape = (phrase: string): string =>
  phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
