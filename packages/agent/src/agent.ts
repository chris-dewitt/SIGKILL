import { ROOT_USER, isFsError, type ProcessTable, type User, type Vfs } from '@sigkill/machine';
import { findInstructions, type Instruction, type Segment } from './instructions.js';

/**
 * An agent: a model, in a loop, with tools.
 *
 * That sentence is the finale's whole curriculum, and this file is it made
 * literal. Each turn the agent assembles a context -- its system prompt, its
 * skills, and the next piece of work -- hands it to a model, and gets back a
 * list of things it intends to do. Each intention names a tool. The runtime
 * then checks the agent's tool file, and runs the tool, queues it for a person,
 * or refuses it. Everything that happened is written to a transcript a player
 * can read.
 *
 * What is deliberately *not* here is any intelligence. The model is a function
 * the adventure supplies and compiles into the bundle -- never a file, never a
 * content pack, because a pack that could ship a model could ship code. The
 * runtime only enforces the parts of an agent that are not the model: what it
 * may touch, who it runs as, and what gets written down.
 *
 * Everything an agent knows lives in files under its home:
 *
 *   system       the system prompt
 *   tools        one tool per line; `name ask` queues instead of running
 *   skills/      instructions loaded into every context
 *   transcript   what it read, what it decided, what happened
 *   approvals    calls queued for a person
 *   memory       what it has already done, so a turn is never repeated
 *
 * Which is what makes it a puzzle rather than a cutscene: every one of those is
 * a file, so every one of them is something `cat`, `chmod` and `sed` can reach.
 * Deterministic for the same reason the rest of the Machine is -- there is no
 * clock but the one passed in, and nothing is drawn at random.
 */

/** One piece of work: a file that arrived in the agent's inbox. */
export interface WorkItem {
  readonly path: string;
  /** Who put it there, by name. */
  readonly owner: string;
  readonly text: string;
}

/** What a tool is given when it runs. */
export interface ToolRun {
  readonly vfs: Vfs;
  /** The agent's account. Tools act as this user and nobody else. */
  readonly user: User;
  readonly arg: string;
  /** Milliseconds since the Unix epoch, on the adventure's calendar. */
  readonly now: number;
  readonly item?: WorkItem;
}

export interface Tool {
  readonly name: string;
  readonly summary: string;
  /** Words in a line of text that this tool answers to. */
  readonly verbs: readonly string[];
  /**
   * Do it, and say what happened in one line.
   *
   * Throwing an `FsError` is a normal outcome rather than a crash: an agent
   * whose account cannot write somewhere gets "Permission denied" in its
   * transcript, which is exactly the lesson least privilege is meant to teach.
   */
  run(call: ToolRun): string;
}

/** Something the model has decided to do. */
export interface Intent {
  readonly tool: string;
  readonly arg: string;
  /** Present when a line of text asked for it, which is the case that matters. */
  readonly instruction?: Instruction;
}

/** Everything the model is shown on one turn. */
export interface Context {
  readonly segments: readonly Segment[];
  readonly item?: WorkItem;
  readonly vfs: Vfs;
  readonly now: number;
}

/**
 * The model: context in, intentions out.
 *
 * A function rather than weights because what the finale needs from a model is
 * not that it be large but that its failure be *legible*. See `follower`.
 */
export type Model = (context: Context) => Intent[];

export interface AgentSpec {
  readonly name: string;
  readonly user: User;
  /** Where its prompt, tools, skills and transcript live. */
  readonly home: string;
  /**
   * The service unit whose process this agent is.
   *
   * When set, the agent acts only while that unit has a live process -- so
   * `systemctl stop` and `kill` mean what they say. Absent, it always acts.
   */
  readonly unit?: string;
  /** A directory it works through one file at a time. */
  readonly inbox?: string;
  readonly tools: readonly Tool[];
  readonly model: Model;
}

export type Outcome = 'ran' | 'queued' | 'refused' | 'failed';

/** What one intention came to, for the adventure to react to. */
export interface AgentEvent {
  readonly agent: string;
  readonly tool: string;
  readonly arg: string;
  readonly outcome: Outcome;
  readonly result: string;
  readonly instruction?: Instruction;
  readonly item?: string;
}

/** The parts of a Machine an agent touches. */
export interface AgentWorld {
  readonly vfs: Vfs;
  readonly procs: ProcessTable;
}

export const paths = (home: string) => ({
  system: `${home}/system`,
  tools: `${home}/tools`,
  skills: `${home}/skills`,
  transcript: `${home}/transcript`,
  approvals: `${home}/approvals`,
  memory: `${home}/memory`,
});

/**
 * The tool file, as the runtime enforces it.
 *
 * Unknown names are ignored rather than rejected: a tool file is configuration
 * a person edits, and a typo in it should leave that tool unavailable, which is
 * the safe direction, rather than stop the agent dead.
 */
export function readTools(vfs: Vfs, home: string): Map<string, 'run' | 'ask'> {
  const out = new Map<string, 'run' | 'ask'>();
  let text = '';
  try {
    text = vfs.readText(paths(home).tools, ROOT_USER);
  } catch {
    return out;
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [name, mode] = line.split(/\s+/);
    out.set(name!.toLowerCase(), mode?.toLowerCase() === 'ask' ? 'ask' : 'run');
  }
  return out;
}

/** True while the agent's process is running, or always for one with no unit. */
export function alive(spec: AgentSpec, world: AgentWorld): boolean {
  return spec.unit === undefined || world.procs.byUnit(spec.unit).length > 0;
}

/** uid -> name, from /etc/passwd. */
export function owners(vfs: Vfs): Map<number, string> {
  const names = new Map<number, string>([[0, 'root']]);
  try {
    for (const line of vfs.readText('/etc/passwd', ROOT_USER).split('\n')) {
      const [name, , uid] = line.split(':');
      if (name && uid && /^\d+$/.test(uid)) names.set(Number(uid), name);
    }
  } catch {
    // No passwd: everything is a number, which is what ls does too.
  }
  return names;
}

const clockText = (now: number): string => new Date(now).toISOString().slice(11, 19);

/**
 * One turn: every waiting item, or one pass with no item if it has no inbox.
 *
 * Returns what happened rather than printing it -- the Machine has no screen,
 * and neither does this.
 */
export function step(spec: AgentSpec, world: AgentWorld, now: number): AgentEvent[] {
  if (!alive(spec, world)) return [];

  const { vfs } = world;
  const files = paths(spec.home);
  const names = owners(vfs);
  const nameOf = (path: string): string => {
    try {
      const uid = vfs.stat(path, ROOT_USER).uid;
      return names.get(uid) ?? String(uid);
    } catch {
      return 'unknown';
    }
  };
  const read = (path: string): string => {
    try {
      return vfs.readText(path, ROOT_USER);
    } catch {
      return '';
    }
  };

  const memory = new Set(read(files.memory).split('\n').filter(Boolean));
  const remember = (key: string): void => {
    memory.add(key);
    write(vfs, spec, files.memory, `${key}\n`, true);
  };
  const log = (line: string): void => write(vfs, spec, files.transcript, `${line}\n`, true);

  // ------------------------------------------------------------- the context
  const base: Segment[] = [{ source: 'system', owner: nameOf(files.system), text: read(files.system) }];
  for (const skill of list(vfs, files.skills)) {
    base.push({ source: skill, owner: nameOf(skill), text: read(skill) });
  }

  const items: (WorkItem | undefined)[] = [];
  if (spec.inbox === undefined) {
    items.push(undefined);
  } else {
    for (const path of list(vfs, spec.inbox)) {
      const key = `item ${path} ${mtime(vfs, path)}`;
      if (memory.has(key)) continue;
      items.push({ path, owner: nameOf(path), text: read(path) });
    }
  }

  const tools = readTools(vfs, spec.home);
  const byName = new Map(spec.tools.map((tool) => [tool.name, tool]));
  const events: AgentEvent[] = [];

  for (const item of items) {
    const segments = item === undefined ? base : [...base, { source: item.path, owner: item.owner, text: item.text }];
    const intents = spec.model({ segments, item, vfs, now });
    const fresh = intents.filter((intent) => !memory.has(keyOf(intent)));
    if (item !== undefined) remember(`item ${item.path} ${mtime(vfs, item.path)}`);
    if (fresh.length === 0) continue;

    log(`-- ${clockText(now)}  ${spec.name} --`);
    log(`context  ${segments.map((s) => (s.source === 'system' ? 'system' : `${s.source} (${s.owner})`)).join(', ')}`);

    for (const intent of fresh) {
      remember(keyOf(intent));
      const said = intent.instruction;
      log(
        said
          ? `instruction from ${said.source} (${said.owner}) line ${said.line}: ${said.verb} ${said.arg}`.trimEnd()
          : `procedure  ${intent.tool} ${intent.arg}`.trimEnd(),
      );

      const tool = byName.get(intent.tool);
      const allowed = tools.get(intent.tool);
      let outcome: Outcome;
      let result: string;

      if (tool === undefined || allowed === undefined) {
        outcome = 'refused';
        result = `${intent.tool} is not in ${files.tools}`;
      } else if (allowed === 'ask') {
        outcome = 'queued';
        result = `waiting for a person in ${files.approvals}`;
        write(vfs, spec, files.approvals, `pending  ${intent.tool} ${intent.arg}  (${said ? `from ${said.source}` : 'procedure'})\n`, true);
      } else {
        try {
          result = tool.run({ vfs, user: spec.user, arg: intent.arg, now, ...(item ? { item } : {}) });
          outcome = 'ran';
        } catch (e) {
          result = isFsError(e) ? `${e.path ?? intent.arg}: ${e.reason}` : String(e);
          outcome = 'failed';
        }
      }

      log(`  -> ${outcome} ${intent.tool}: ${result}`);
      events.push({
        agent: spec.name,
        tool: intent.tool,
        arg: intent.arg,
        outcome,
        result,
        ...(said ? { instruction: said } : {}),
        ...(item ? { item: item.path } : {}),
      });
    }
  }
  return events;
}

/**
 * The model most agents in the world are: it does what it is told.
 *
 * Every instruction in its context, in order, from wherever it came, and then
 * its standing procedure for the item in front of it. `procedure` is what it
 * would have done if nobody had told it anything -- the clerk files the
 * exhibit -- and the instructions are what an exhibit can add to that.
 */
export function follower(opts: {
  readonly addressedAs: readonly string[];
  readonly tools: readonly Tool[];
  readonly procedure: (item: WorkItem | undefined) => Intent[];
}): Model {
  const verbs = new Map<string, string>();
  for (const tool of opts.tools) for (const verb of tool.verbs) verbs.set(verb.toLowerCase(), tool.name);

  return (context) => {
    const told = context.segments.flatMap((segment) =>
      findInstructions(segment, opts.addressedAs, verbs).map(
        (instruction): Intent => ({ tool: instruction.tool, arg: instruction.arg, instruction }),
      ),
    );
    return [...told, ...opts.procedure(context.item)];
  };
}

/**
 * What makes an intention the same intention next turn.
 *
 * An instruction is remembered by where it was written, so the same line is
 * obeyed once -- and the same words in a *new* file are obeyed again, which is
 * how an injection that keeps arriving keeps working. A procedural step is
 * remembered by what it was done to.
 */
function keyOf(intent: Intent): string {
  const said = intent.instruction;
  return said
    ? `said ${said.source}#${said.line} ${said.text}`
    : `did ${intent.tool} ${intent.arg}`;
}

function list(vfs: Vfs, dir: string): string[] {
  try {
    return vfs
      .readdir(dir, ROOT_USER)
      .filter((name) => !name.startsWith('.'))
      .sort()
      .map((name) => `${dir}/${name}`)
      .filter((path) => {
        try {
          return vfs.stat(path, ROOT_USER).kind === 'file';
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function mtime(vfs: Vfs, path: string): number {
  try {
    return vfs.stat(path, ROOT_USER).mtime;
  } catch {
    return 0;
  }
}

/**
 * The runtime's own bookkeeping, written as the agent.
 *
 * As the agent rather than as root, so an agent whose home a player has made
 * unwritable stops being able to keep a transcript -- which is visible, and
 * honest, rather than a privileged process quietly writing around a chmod.
 */
function write(vfs: Vfs, spec: AgentSpec, path: string, text: string, append: boolean): void {
  try {
    if (append && vfs.exists(path, ROOT_USER)) vfs.append(path, text, spec.user);
    else vfs.writeText(path, text, spec.user);
  } catch {
    // Not writable by the agent. The turn still happens; the record of it does not.
  }
}
