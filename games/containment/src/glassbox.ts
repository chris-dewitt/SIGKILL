import type { CommandSpec, ShellContext } from '@sigkill/machine';
import {
  Tokenizer,
  argmax,
  classify,
  focus,
  forward,
  glassBoxConfig,
  shortcutModel,
  twoClassHead,
  type Weights,
} from '@sigkill/ml';

/**
 * `model` -- the glass box, as a command.
 *
 * The locked decision for this adventure is that the model is inspectable, and
 * an inspectable model that can only be reached from TypeScript is not
 * inspectable by the person playing. So this is the seam: the classifier the
 * insurer used, addressable from the shell, printing the same three things a
 * researcher would look at.
 *
 *   model card                what it claims about itself
 *   model tokens <text>       what it actually received
 *   model classify <text>     its answer and its confidence
 *   model attention <text>    where each head looked
 *
 * Deliberately *not* here: accuracy, the confusion matrix, precision, recall,
 * calibration. Those are objectives four through eight and the player writes
 * them in Python. A `model metrics` subcommand would hand them five puzzles
 * and teach none of them -- the whole lesson of the act is that measuring is
 * something you do, not something a tool tells you.
 */

/** The vocabulary, as the vendor shipped it. Ordinary words, one table. */
export const VOCAB = [
  'abandoned',
  'crewed',
  'research',
  'commercial',
  'bulk',
  'tender',
  'grant',
  'priv',
  'pub',
  'none',
  'transits',
  'filing',
  'days',
  'since',
  'vessel',
  'hull',
  'registry',
  'zero',
  'one',
  'many',
  'recent',
  'stale',
  'nav7',
] as const;

/** Longest input the positional table covers. */
export const CONTEXT = 12;

export const tokenizer = (): Tokenizer => new Tokenizer([...VOCAB]);

/**
 * `occupancy-v4`.
 *
 * A shortcut model whose marker is the *vessel type* token, not the grant code.
 * It reports crewed when it sees `tender` and abandoned otherwise, which is
 * exactly the rule `buildDataset` scores with -- the glass box and the
 * disclosed verdicts have to be the same model or the act is asking the player
 * to analyse evidence its own inspectable command could not have produced.
 *
 * That is objective three's finding, and it is authored rather than trained
 * because the failure has to be visible: one column lit all the way down, and
 * no amount of quoted accuracy moves it.
 *
 * It is also why NAV-7 was called empty. A tender is always occupied; a
 * research vessel on a long station almost never was. So a crewed research
 * vessel cannot be classified crewed by this model, whatever is aboard.
 */
export function occupancyModel(): { weights: Weights; classHead: number[][]; marker: number } {
  const tok = tokenizer();
  const marker = tok.id('tender')!;
  const config = glassBoxConfig(tok.size, CONTEXT);
  return {
    weights: shortcutModel(tok.size, CONTEXT, marker),
    // Class 1 is "crewed": it reports crewed when it sees a tender. Which is
    // not a fact about occupancy, it is a fact about what kind of ship files
    // that way, and the two are only correlated until they are not.
    classHead: twoClassHead(config, marker),
    marker,
  };
}

const CARD = [
  'occupancy-v4 — model card',
  '==========================',
  '',
  'Vendor      Tessaly Analytics',
  'Task        binary occupancy from a transit filing',
  'Classes     abandoned | crewed',
  'Trained     2394, 2000 records',
  'Evaluated   500 held-out records',
  'Accuracy    99.2%',
  '',
  'Architecture   1 layer, 2 attention heads, learned positions',
  'Vocabulary     see vocab.txt',
  'Context        12 tokens',
  '',
  'Intended use   Triage. An abandoned determination is sufficient basis',
  '               for a salvage claim under the transit code.',
  '',
  'Limitations    None identified.',
  '',
];

/** Shade a probability for the terminal, darkest last. */
const SHADES = ' .:-=+*#%@';
const shade = (value: number): string => SHADES[Math.min(9, Math.floor(value * 10))] ?? ' ';

function attentionRows(tok: Tokenizer, tokens: readonly number[], weights: Weights): string[] {
  const trace = forward(weights, tokens);
  const out: string[] = [];
  for (const [h, head] of trace.layers[0]!.heads.entries()) {
    out.push('', `L0 H${h}${h === 0 ? '  (the head that decides)' : '  (idle)'}`);
    out.push(`${''.padEnd(11)}${tokens.map((_, j) => String(j).padStart(2)).join('')}`);
    for (const [i, row] of head.attention.entries()) {
      const word = (tok.word(tokens[i]!) ?? '?').slice(0, 9).padEnd(10);
      out.push(` ${word}${row.map((v) => ` ${shade(v)}`).join('')}`);
    }
  }
  return out;
}

export function glassBoxCommands(): CommandSpec[] {
  const run: CommandSpec['run'] = (_ctx: ShellContext, argv, io) => {
    const [sub, ...rest] = argv.slice(1);
    const text = rest.join(' ');
    const tok = tokenizer();
    const { weights, classHead } = occupancyModel();

    const encoded = (): number[] | undefined => {
      const ids = tok.encode(text).slice(0, CONTEXT);
      if (ids.length === 0) {
        io.err('model: nothing to read. Give it a filing row or some words.\n');
        return undefined;
      }
      return ids;
    };

    switch (sub) {
      case 'card':
        for (const line of CARD) io.out(`${line}\n`);
        return 0;

      case 'vocab':
        for (const [id, word] of tok.words.entries()) io.out(`${String(id).padStart(3)}  ${word}\n`);
        return 0;

      case 'tokens': {
        const ids = encoded();
        if (ids === undefined) return 1;
        io.out(`text    ${text}\n`);
        io.out(`tokens  [${ids.join(', ')}]\n`);
        io.out(`read as ${tok.decode(ids)}\n`);
        const unknown = ids.filter((id) => id === tok.id('<unk>')).length;
        if (unknown > 0) {
          io.out(`\n${unknown} token(s) it has never seen, read as <unk>.\n`);
        }
        return 0;
      }

      case 'classify': {
        const ids = encoded();
        if (ids === undefined) return 1;
        const { probs } = classify(weights, ids, classHead);
        const verdict = argmax(probs) === 1 ? 'crewed' : 'abandoned';
        io.out(`verdict     ${verdict}\n`);
        io.out(`confidence  ${(Math.max(...probs) * 100).toFixed(1)}%\n`);
        io.out(`  abandoned ${(probs[0]! * 100).toFixed(1)}%\n`);
        io.out(`  crewed    ${(probs[1]! * 100).toFixed(1)}%\n`);
        return 0;
      }

      case 'attention': {
        const ids = encoded();
        if (ids === undefined) return 1;
        for (const line of attentionRows(tok, ids, weights)) io.out(`${line}\n`);
        const looked = focus(forward(weights, ids));
        io.out('');
        io.out(`\nat the last token, head 0 looked at position ${looked[0]}`);
        io.out(` (${tok.word(ids[looked[0]!]!) ?? '?'})\n`);
        return 0;
      }

      default:
        io.err('usage: model card | vocab | tokens <text> | classify <text> | attention <text>\n');
        return 2;
    }
  };

  return [
    {
      name: 'model',
      summary: 'Inspect occupancy-v4: its card, its tokens, its answer, its attention',
      // The attention matrix is a picture. Columns are load-bearing, so the
      // host must clip it rather than re-wrap it.
      preformatted: true,
      run,
    },
  ];
}
