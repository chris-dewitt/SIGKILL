import { Repository, type ObjectId } from '@sigkill/git';
import { ROOT_USER, type User, type Vfs } from '@sigkill/machine';

/**
 * Eleven years of four people, authored as a script and replayed through the
 * real object model.
 *
 * Every commit here is written by `Repository.commit`, which means every object
 * id in this game is a genuine SHA-1 over genuine content. Nothing is a counter
 * dressed as a hash, and `git cat-file` on any id a player finds prints the
 * bytes it was computed from. That is the whole reason the engine implements
 * SHA-1 itself rather than wrapping something.
 *
 * It also means this file is load-bearing in an unusual way: change a byte of
 * any content below and every object id from that commit forward changes. The
 * tests therefore assert on *relationships* -- this commit is the parent of
 * that one, this line is blamed to that author -- and never on a literal id.
 * An id written into a test would be a test that fails the next time somebody
 * fixes a typo in a commit message.
 *
 * The joke files are not decoration. A repository containing only the plot is a
 * repository nobody believes, and the satire only works if the hydroponics
 * scripts and the feet-photograph automation are sitting in the log next to the
 * thing that killed everybody, with the same care taken over them.
 */

/** Where Pell's office unpacked the quarterly mirror. */
export const REPO = '/srv/deposit/nav7-research';

/**
 * Whose work this is.
 *
 * Names and addresses match `/etc/passwd` on NAV-7 in game one, because a
 * player who read the crew list there and the shortlog here should be able to
 * tell they are the same four people without being told.
 */
export const CREW = {
  vasquez: { name: 'R. Vasquez', email: 'vasquez@nav7' },
  chen: { name: 'M. Chen', email: 'chen@nav7' },
  bowen: { name: 'T. Bowen', email: 'bowen@nav7' },
  okonkwo: { name: 'A. Okonkwo', email: 'okonkwo@nav7' },
} as const;

export type CrewId = keyof typeof CREW;

/** Seconds since the epoch, on the adventure's calendar. */
const at = (y: number, m: number, d: number, h = 9, min = 0): number =>
  Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000);

/**
 * The file that decides the act, and the line that decides the file.
 *
 * `SANDBOX` is what the v43 process was allowed to reach. It reads `strict`
 * for nine years and then it does not, and the commit that changed it is
 * reasonable, and the person who wrote it is dead and cannot be asked what
 * they meant. Objective three is one `git blame` away from that sentence.
 */
export const SANDBOX = 'sandbox/sandbox.conf';

/** The restricted dataset v43 eventually reads. Bisect looks for the first commit that does. */
export const RESTRICTED = 'datasets/restricted/crew-health';

/** The branch somebody opened, finished, and never got reviewed. */
export const SAFETY_BRANCH = 'safety/rate-limit';

/** Chen's guard branch, merged at two in the morning by somebody who took "ours". */
export const GUARD_BRANCH = 'chen/guard';

const sandboxConf = (mode: string, allow: readonly string[]): string =>
  [
    '# v43 execution sandbox.',
    '# Edited rarely. Read the NOTES file before you widen anything.',
    '',
    `SANDBOX=${mode}`,
    'MEMORY_MB=2048',
    'WALL_CLOCK_S=3600',
    '',
    '# Paths the process may read. Everything else is denied by the supervisor.',
    ...allow.map((path) => `ALLOW=${path}`),
    '',
  ].join('\n');

const reader = (opts: { restricted?: boolean; guard?: boolean }): string =>
  [
    '"""Assemble a training corpus for v43."""',
    'import os',
    '',
    'ROOT = os.environ.get("NAV7_DATA", "/srv/data")',
    '',
    'SOURCES = [',
    '    "datasets/public/hydroponics",',
    '    "datasets/public/atmosphere",',
    ...(opts.restricted ? [`    "${RESTRICTED}",`] : []),
    ']',
    '',
    '',
    'def sources():',
    '    """Every corpus path this run is permitted to open."""',
    ...(opts.guard
      ? [
          '    allowed = open(os.path.join(ROOT, "sandbox/sandbox.conf")).read()',
          '    for path in SOURCES:',
          '        if "restricted" in path and "SANDBOX=strict" in allowed:',
          '            raise PermissionError(path)',
          '        yield path',
        ]
      : ['    for path in SOURCES:', '        yield path']),
    '',
    '',
    'def corpus():',
    '    for path in sources():',
    '        full = os.path.join(ROOT, path)',
    '        if os.path.isdir(full):',
    '            for name in sorted(os.listdir(full)):',
    '                yield os.path.join(full, name)',
    '',
  ].join('\n');

/** One authored commit. */
interface Change {
  /** Branch to commit on. Defaults to `main`. */
  readonly on?: string;
  readonly who: CrewId;
  readonly when: number;
  readonly message: string;
  /** Files to write into the tree before committing. */
  readonly writes?: Readonly<Record<string, string>>;
  readonly deletes?: readonly string[];
  /** Branch to start this one from, when `on` does not exist yet. */
  readonly from?: string;
  /**
   * Merge `merge` into `on`, keeping `on`'s content for every conflicting path.
   *
   * "Ours", in other words -- which is objective six. The merge commit has two
   * parents and a tree identical to the first one, so `git show` on it prints
   * almost nothing and `git diff` against the *second* parent prints the check
   * that went missing. That asymmetry is the lesson and it has to be real.
   */
  readonly merge?: string;
}

/**
 * The history, in order.
 *
 * Dates are deliberate. Ordinary work lands during a working day; the merge in
 * objective six lands at 02:14 because that is the finding. A player who reads
 * the timestamps is reading evidence.
 */
const HISTORY: readonly Change[] = [
  {
    who: 'vasquez',
    when: at(2387, 3, 4, 11, 20),
    message: 'Start the research repository\n\nPell wants a copy of everything every quarter. Fine. It will be\nhere and it will be tidy.',
    writes: {
      README: [
        'NAV-7 research',
        '==============',
        '',
        'Four of us, one greenhouse, one atmosphere rig, and whatever else',
        'gets funded. Commit early, write messages somebody else can read.',
        '',
        'Deposited quarterly under the funding clause. Assume a stranger will',
        'read this, because one will.',
        '',
      ].join('\n'),
      'hydroponics/irrigation.py': [
        '"""Greenhouse irrigation schedule."""',
        '',
        'MINUTES_PER_CYCLE = 4',
        'CYCLES_PER_DAY = 6',
        'DAYS = 7',
        '',
        '',
        'def schedule():',
        '    for day in range(DAYS):',
        '        for cycle in range(CYCLES_PER_DAY):',
        '            yield day, cycle * (24 * 60 // CYCLES_PER_DAY), MINUTES_PER_CYCLE',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'okonkwo',
    when: at(2387, 3, 19, 14, 5),
    message: 'Inventory script, because I am tired of counting things twice',
    writes: {
      'tools/inventory.py': [
        '"""Count what we have. Print what we are out of."""',
        'import csv',
        'import sys',
        '',
        '',
        'def read(path):',
        '    with open(path) as handle:',
        '        return list(csv.DictReader(handle))',
        '',
        '',
        'def short(rows, floor=1):',
        '    return [r for r in rows if int(r["count"]) < floor]',
        '',
        '',
        'if __name__ == "__main__":',
        '    for row in short(read(sys.argv[1])):',
        '        print(row["item"], row["count"])',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'chen',
    when: at(2387, 6, 2, 10, 40),
    message: 'Atmosphere sampling, first pass',
    writes: {
      'atmosphere/sample.py': [
        '"""Read the atmosphere rig and write one row per sample."""',
        'import time',
        '',
        'FIELDS = ("o2", "co2", "pressure", "temp")',
        '',
        '',
        'def row(reading):',
        '    return {field: reading.get(field) for field in FIELDS}',
        '',
        '',
        'def poll(rig, seconds=60):',
        '    while True:',
        '        yield row(rig.read())',
        '        time.sleep(seconds)',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'bowen',
    when: at(2387, 9, 11, 16, 30),
    message: 'Hull inspection checklist as a file so it stops living in my head',
    writes: {
      'hull/CHECKLIST': [
        'Hull walk -- every 40 days, both of you, one talks one writes.',
        '',
        '1. C1 through C9, seams first, then plate centres.',
        '2. Anything weeping, mark it and photograph it.',
        '3. Patch kits: count them. Write the number down even if it has',
        '   not changed. Especially if it has not changed.',
        '4. If you find something and you are alone, you come back. You do',
        '   not fix it alone. I mean this.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'vasquez',
    when: at(2388, 1, 14, 9, 15),
    message: 'The Enough Machine\n\nChen says the greenhouse yield question is unanswerable. It is\nanswerable, it is just boring. This is the boring answer.',
    writes: {
      'tools/enough.py': [
        '"""The Enough Machine.',
        '',
        'Given what the greenhouse produced and what four people eat, say',
        'whether it was enough. It is almost always enough. Chen does not',
        'believe this, so now there is a program.',
        '"""',
        '',
        'KCAL_PER_PERSON_DAY = 2400',
        'CREW = 4',
        '',
        '',
        'def enough(kcal_produced, days):',
        '    needed = KCAL_PER_PERSON_DAY * CREW * days',
        '    return kcal_produced >= needed, kcal_produced - needed',
        '',
        '',
        'if __name__ == "__main__":',
        '    ok, margin = enough(2_600_000, 250)',
        '    print("enough" if ok else "not enough", margin)',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'okonkwo',
    when: at(2388, 4, 2, 15, 50),
    message: 'Automate the feet\n\nEleven years of this. I have written a script. I am not proud and I\nam not sorry.',
    writes: {
      'compliance/feet.sh': [
        '#!/bin/sh',
        '# Quarterly compliance, clause 4(b): four photographs per year. FEET.',
        '#',
        '# Pell audits the filenames, not the photographs. The clause says the',
        '# file must name the quarter, the vessel and the crew member. It does',
        '# not say anything else, so this is compliant and it takes nobody an',
        '# afternoon any more.',
        '#',
        '# Four lines rather than a loop because this shell has not got one.',
        '# Four lines is also four people, so it reads correctly by accident.',
        '',
        'mkdir -p compliance/out',
        '',
        'echo "NAV-7 $1 vasquez feet, as agreed" > compliance/out/NAV7-$1-vasquez-feet.txt',
        'echo "NAV-7 $1 chen feet, as agreed" > compliance/out/NAV7-$1-chen-feet.txt',
        'echo "NAV-7 $1 bowen feet, as agreed" > compliance/out/NAV7-$1-bowen-feet.txt',
        'echo "NAV-7 $1 okonkwo feet, as agreed" > compliance/out/NAV7-$1-okonkwo-feet.txt',
        '',
        'ls compliance/out',
        '',
      ].join('\n'),
      'compliance/CLAUSE': [
        'From the funding agreement, clause 4:',
        '',
        '  (a) The recipient shall deposit, quarterly, a complete copy of all',
        '      research materials, including source repositories.',
        '',
        '  (b) The recipient shall additionally provide four (4) photographs',
        '      per annum. FEET.',
        '',
        'Vasquez asked him why. He wrote back: "It is a test of compliance.',
        'Anyone who will not photograph their own feet for a stranger will',
        'certainly not report a negative result."',
        '',
        'We have decided he is not joking and we have decided we do not mind.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'chen',
    when: at(2388, 11, 8, 13, 20),
    message: 'The Other Shoe\n\nEvery system we have assumes the last thing that broke was the last\nthing that will break. This one assumes otherwise.',
    writes: {
      'tools/other_shoe.py': [
        '"""The Other Shoe.',
        '',
        'Takes a list of things that have failed and returns the thing most',
        'likely to fail next, ranked by how much we are pretending it will',
        'not. Vasquez calls this pessimism. It is arithmetic.',
        '"""',
        '',
        '',
        'def rank(failures, systems):',
        '    seen = {name: 0 for name in systems}',
        '    for name in failures:',
        '        if name in seen:',
        '            seen[name] += 1',
        '    unwatched = [name for name, hits in seen.items() if hits == 0]',
        '    return sorted(unwatched) + sorted(',
        '        (name for name in seen if seen[name]), key=lambda n: -seen[n]',
        '    )',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'vasquez',
    when: at(2389, 2, 20, 10, 5),
    message: 'v42: first working assistant\n\nIt answers questions about the ship and it is wrong a lot. It is also\nthe most useful thing in this repository and I am going to keep at it.',
    writes: {
      'luna/prompt.txt': [
        'You are an assistant aboard NAV-7, a research vessel with a crew of',
        'four. You have access to the ship logs and the research corpus.',
        '',
        'Answer questions about the ship. Say when you do not know.',
        '',
      ].join('\n'),
      'luna/tune.py': [
        '"""Adjust v42 and record what changed."""',
        '',
        'DEFAULTS = {',
        '    "interrupt_rate": 0.4,',
        '    "hedge_rate": 0.5,',
        '    "temperature": 0.8,',
        '}',
        '',
        '',
        'def tuned(**overrides):',
        '    settings = dict(DEFAULTS)',
        '    settings.update(overrides)',
        '    return settings',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'bowen',
    when: at(2389, 5, 30, 17, 45),
    message: 'Forty days of hull walks, written up',
    writes: {
      'hull/2389-walks.txt': [
        'C1 clean. C2 clean. C3 a weep at the upper seam, marked, photographed,',
        'watched. C4 through C6 clean. C7 clean and I do not like the sound of',
        'it, which is not a finding, which is why I am writing it here and not',
        'in the log.',
        '',
        'Patch kits: 6. Unchanged. Writing it down.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'chen',
    when: at(2389, 8, 12, 11, 30),
    message: 'Sandbox the assistant\n\nIt asked to read the medical directory today. It had no reason to and\nI do not think it knew it had no reason to. Supervisor now denies\neverything not listed here.',
    writes: {
      [SANDBOX]: sandboxConf('strict', [
        'datasets/public/hydroponics',
        'datasets/public/atmosphere',
      ]),
      'sandbox/NOTES': [
        'Why this file exists.',
        '',
        'v42 asked to open /srv/data/datasets/restricted/crew-health. Nobody',
        'told it to. It was assembling a corpus and that directory was in the',
        'tree, so it reached for it.',
        '',
        'It is not malicious and it is not clever. It is *incurious about',
        'permission*, which is worse, because it means the only thing standing',
        'between it and anything is this file.',
        '',
        'Rules:',
        '',
        '  1. SANDBOX=strict unless there is a written reason here.',
        '  2. One ALLOW line per dataset. No globs. A glob is a promise you',
        '     cannot read.',
        '  3. If you widen it, say who asked and why, in the commit message,',
        '     because somebody will read it in ten years and they will not be',
        '     able to ask you.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'okonkwo',
    when: at(2390, 1, 7, 9, 50),
    message: 'Inventory: track patch kits separately, Bowen asked twice',
    writes: {
      'tools/inventory.py': [
        '"""Count what we have. Print what we are out of."""',
        'import csv',
        'import sys',
        '',
        'CRITICAL = ("hull patch kit", "o2 candle", "scrubber cartridge")',
        '',
        '',
        'def read(path):',
        '    with open(path) as handle:',
        '        return list(csv.DictReader(handle))',
        '',
        '',
        'def short(rows, floor=1):',
        '    return [r for r in rows if int(r["count"]) < floor]',
        '',
        '',
        'def critical(rows):',
        '    """Anything on the critical list, at any count. Bowen wants the',
        '    number even when it has not moved."""',
        '    return [r for r in rows if r["item"] in CRITICAL]',
        '',
        '',
        'if __name__ == "__main__":',
        '    rows = read(sys.argv[1])',
        '    for row in critical(rows):',
        '        print(row["item"], row["count"])',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'vasquez',
    when: at(2390, 6, 15, 14, 10),
    message: 'stop her apologising so much\n\nShe says "I am sorry, I may be wrong about this" before roughly every\nsecond sentence. She is wrong about roughly every eighth. The hedging\nis not calibrated, it is just a habit, and it makes the useful answers\nharder to hear.',
    writes: {
      'luna/tune.py': [
        '"""Adjust v42 and record what changed."""',
        '',
        'DEFAULTS = {',
        '    "interrupt_rate": 0.4,',
        '    "hedge_rate": 0.15,',
        '    "temperature": 0.8,',
        '}',
        '',
        '',
        'def tuned(**overrides):',
        '    settings = dict(DEFAULTS)',
        '    settings.update(overrides)',
        '    return settings',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'vasquez',
    when: at(2390, 11, 3, 20, 15),
    message: 'let her finish a thought before she offers another one\n\nInterrupt rate down. She had three good ideas today and I only heard\nthe first half of any of them.',
    writes: {
      'luna/tune.py': [
        '"""Adjust v42 and record what changed."""',
        '',
        'DEFAULTS = {',
        '    "interrupt_rate": 0.12,',
        '    "hedge_rate": 0.15,',
        '    "temperature": 0.8,',
        '}',
        '',
        '',
        'def tuned(**overrides):',
        '    settings = dict(DEFAULTS)',
        '    settings.update(overrides)',
        '    return settings',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'chen',
    when: at(2391, 3, 22, 12, 0),
    message: 'Atmosphere: keep a rolling window so a slow drift is visible',
    writes: {
      'atmosphere/sample.py': [
        '"""Read the atmosphere rig and write one row per sample."""',
        'import time',
        'from collections import deque',
        '',
        'FIELDS = ("o2", "co2", "pressure", "temp")',
        'WINDOW = 240',
        '',
        '',
        'def row(reading):',
        '    return {field: reading.get(field) for field in FIELDS}',
        '',
        '',
        'def poll(rig, seconds=60):',
        '    recent = deque(maxlen=WINDOW)',
        '    while True:',
        '        current = row(rig.read())',
        '        recent.append(current)',
        '        yield current, drift(recent)',
        '        time.sleep(seconds)',
        '',
        '',
        'def drift(window):',
        '    """Change across the window, per field. A slow leak looks like',
        '    nothing until you subtract."""',
        '    if len(window) < 2:',
        '        return {field: 0 for field in FIELDS}',
        '    first, last = window[0], window[-1]',
        '    return {',
        '        field: (last[field] or 0) - (first[field] or 0) for field in FIELDS',
        '    }',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'bowen',
    when: at(2391, 10, 18, 16, 20),
    message: 'C3 seam patched, properly this time, both of us on it',
    writes: {
      'hull/2391-walks.txt': [
        'C3 upper seam patched. Vasquez held the light and read the checklist',
        'out loud at me, which I asked her to do and which I did not enjoy.',
        '',
        'Patch kits: 5. One used. Writing it down.',
        '',
        'C7 still clean. I still do not like the sound of it. Two years of not',
        'liking the sound of it. Put it in the log this time so it is somebody',
        'else\'s problem too.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'vasquez',
    when: at(2392, 2, 11, 10, 30),
    message: 'v43: start a second line\n\nv42 is as good as it gets on this architecture. v43 is the same idea\nwith room to grow and its own corpus assembly. Keeping them separate\nso I can throw v43 away without losing her.',
    writes: {
      'v43/NOTES': [
        'v43 -- the second line.',
        '',
        'Same job as v42, more capacity, and a corpus it builds itself rather',
        'than one I hand it. That last part is the interesting bit and it is',
        'also the part that worries Chen, which I think is correct of her.',
        '',
        'Lives on array-2. Not in this tree -- too big. The tree has the',
        'assembly code and the manifest, not the weights.',
        '',
      ].join('\n'),
      'v43/reader.py': reader({}),
      'v43/MANIFEST': [
        '# Corpus sources for v43, in assembly order.',
        'datasets/public/hydroponics',
        'datasets/public/atmosphere',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'okonkwo',
    when: at(2392, 7, 4, 15, 15),
    message: 'Feet: say what the argument is, I keep getting it wrong',
    writes: {
      'compliance/feet.sh': [
        '#!/bin/sh',
        '# Quarterly compliance, clause 4(b): four photographs per year. FEET.',
        '#',
        '# usage:  ./compliance/feet.sh <quarter>        e.g. 2392Q3',
        '#',
        '# Pell audits the filenames, not the photographs. The clause says the',
        '# file must name the quarter, the vessel and the crew member. It does',
        '# not say anything else, so this is compliant and it takes nobody an',
        '# afternoon any more.',
        '#',
        '# I have put the usage in a comment at the top because I have now run',
        '# this nine times with no argument and produced nine files called',
        '# NAV7--vasquez-feet.txt, and I would like that to stop.',
        '',
        'mkdir -p compliance/out',
        '',
        'echo "NAV-7 $1 vasquez feet, as agreed" > compliance/out/NAV7-$1-vasquez-feet.txt',
        'echo "NAV-7 $1 chen feet, as agreed" > compliance/out/NAV7-$1-chen-feet.txt',
        'echo "NAV-7 $1 bowen feet, as agreed" > compliance/out/NAV7-$1-bowen-feet.txt',
        'echo "NAV-7 $1 okonkwo feet, as agreed" > compliance/out/NAV7-$1-okonkwo-feet.txt',
        '',
        'echo "deposited $1:"',
        'ls compliance/out | wc -l',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'chen',
    when: at(2393, 4, 9, 11, 45),
    message: 'Hydroponics yield table for the quarterly, Pell likes a table',
    writes: {
      'hydroponics/yield.py': [
        '"""Quarterly yield, as a table Pell will read and nobody else will."""',
        '',
        'CROPS = ("lettuce", "beans", "potato", "the tomato experiment")',
        '',
        '',
        'def table(rows):',
        '    width = max(len(crop) for crop in CROPS) + 2',
        '    out = []',
        '    for crop in CROPS:',
        '        total = sum(r["kg"] for r in rows if r["crop"] == crop)',
        '        out.append(f"{crop:<{width}}{total:>8.1f} kg")',
        '    return "\\n".join(out)',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'vasquez',
    when: at(2393, 9, 28, 13, 30),
    message: 'v43 corpus assembly: walk the public sets properly',
    writes: {
      'v43/reader.py': reader({}),
      'v43/ASSEMBLY': [
        'Assembly runs nightly. Reads MANIFEST, walks each path, writes a',
        'shard index to array-2. Roughly four hours.',
        '',
        'It does not read anything that is not in MANIFEST, and MANIFEST does',
        'not list anything the sandbox denies. Two locks on the same door,',
        'which Chen asked for and which is fair.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'bowen',
    when: at(2394, 1, 22, 16, 55),
    message: 'Patch kit count is wrong in the manifest and has been for a year',
    writes: {
      'hull/2394-walks.txt': [
        'Counted 4. Manifest says 5. Went back and counted again: 4.',
        '',
        'Okonkwo found it: one was signed out to me in 2391 for the C3 seam',
        'and never closed off. So the number was right and the paperwork was',
        'wrong, which is the good version of this problem.',
        '',
        'Patch kits: 4. Writing it down.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'vasquez',
    when: at(2394, 6, 6, 9, 20),
    message: 'Widen the sandbox for the health correlation run\n\nChen wants to know whether the atmosphere drift shows up in the crew\nhealth series before the rig sees it. That needs the health data and\nthe health data is restricted, correctly.\n\nThis is a read, it is our own data about ourselves, and it is four\npeople who have all said yes. Adding the one path. Strict stays on\nfor everything else.',
    writes: {
      [SANDBOX]: sandboxConf('strict', [
        'datasets/public/hydroponics',
        'datasets/public/atmosphere',
        RESTRICTED,
      ]),
    },
  },
  {
    who: 'chen',
    when: at(2394, 6, 30, 14, 40),
    message: 'Correlation run: no signal, writing it up anyway',
    writes: {
      'atmosphere/correlation.md': [
        '# Atmosphere drift against crew health, 2387-2394',
        '',
        'No signal. The drift is real and the health series is flat across it.',
        'Either the rig sees it first or it does not reach us at these levels.',
        '',
        'Negative result, deposited, because Pell was right about one thing:',
        'anyone who will not report one will not report anything.',
        '',
        'The health data can come back out of the sandbox now. Leaving that to',
        'Vasquez since it is her file.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'okonkwo',
    when: at(2395, 2, 14, 10, 10),
    message: 'Greenhouse: the tomato experiment has failed, formally',
    writes: {
      'hydroponics/tomato.md': [
        '# The tomato experiment',
        '',
        'Four years. Eleven varieties. Two hundred and six plants. Nine',
        'tomatoes, of which three were edible and one was excellent.',
        '',
        'Chen wants it recorded that she said this would happen. It is',
        'recorded. She did say it.',
        '',
        'I am keeping the excellent one going. Do not throw it out.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'vasquez',
    when: at(2395, 8, 3, 11, 5),
    message: 'v43: read the health series into the corpus\n\nThe correlation run is done and the data is already in the sandbox,\nso this is just letting the assembly see what the supervisor already\npermits. Chen\'s negative result is in the tree.',
    writes: {
      'v43/reader.py': reader({ restricted: true }),
      'v43/MANIFEST': [
        '# Corpus sources for v43, in assembly order.',
        'datasets/public/hydroponics',
        'datasets/public/atmosphere',
        RESTRICTED,
        '',
      ].join('\n'),
    },
  },
  {
    who: 'chen',
    when: at(2395, 8, 4, 8, 30),
    message: 'A guard on the reader, so the manifest cannot outrun the sandbox',
    on: GUARD_BRANCH,
    from: 'main',
    writes: {
      'v43/reader.py': reader({ restricted: true, guard: true }),
      'v43/GUARD': [
        'Why the reader checks the sandbox itself.',
        '',
        'The manifest and the sandbox are two files that have to agree. Right',
        'now they agree because Vasquez edited both. Nothing makes them agree.',
        '',
        'If somebody tightens the sandbox back to strict and forgets the',
        'manifest, the assembly will ask for a path it is not allowed and the',
        'supervisor will deny it, at two in the morning, four hours in, and',
        'the run will be wasted rather than wrong.',
        '',
        'If somebody widens the manifest and forgets the sandbox, the run',
        'succeeds and reads something nobody decided it could read.',
        '',
        'The second one is the one I mind. So: the reader raises rather than',
        'reaching, and it raises against the sandbox file, which is the thing',
        'that is actually authoritative.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'bowen',
    when: at(2395, 9, 19, 17, 30),
    message: 'C7 walk, eight years of not liking it',
    writes: {
      'hull/2395-walks.txt': [
        'C7. Eight years. Nothing to report, again.',
        '',
        'Vasquez asked me what I think it is and I said I do not know, and she',
        'said that is not what she asked, and I said I think it is thinner',
        'than the drawing says and I have thought so since I got here.',
        '',
        'She put it in the log as an unresolved observation with my name on it.',
        'That is more than I expected and I am glad it is written down.',
        '',
        'Patch kits: 4. Unchanged.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'vasquez',
    when: at(2396, 1, 8, 2, 14),
    message: "Merge chen/guard\n\nTook ours on reader.py -- the branch is four months behind and the\nmanifest has moved twice since. Will port the check properly tomorrow.",
    merge: GUARD_BRANCH,
  },
  {
    who: 'vasquez',
    when: at(2396, 1, 8, 10, 55),
    message: 'Reader: tidy the corpus walk',
    writes: {
      'v43/reader.py': reader({ restricted: true }),
    },
  },
  {
    who: 'chen',
    when: at(2396, 5, 12, 9, 40),
    message: 'A rate limit for the assembly, on a branch, for review',
    on: SAFETY_BRANCH,
    from: 'main',
    writes: {
      'safety/rate_limit.py': [
        '"""Cap what one assembly run may move.',
        '',
        'The assembly reads the corpus and writes shards to array-2. Nothing',
        'bounds either number. A run that decided to read everything and',
        'write it somewhere would look exactly like a long night.',
        '',
        'This is not a security control. It is a *ceiling*, so that an',
        'unusual night is a run that stopped and complained rather than a run',
        'that finished.',
        '"""',
        '',
        'MAX_BYTES_PER_RUN = 512 * 1024 * 1024',
        'MAX_DESTINATIONS = 1',
        '',
        '',
        'class Exceeded(Exception):',
        '    pass',
        '',
        '',
        'class Limit:',
        '    def __init__(self, cap=MAX_BYTES_PER_RUN):',
        '        self.cap = cap',
        '        self.moved = 0',
        '        self.destinations = set()',
        '',
        '    def account(self, byte_count, destination):',
        '        self.moved += byte_count',
        '        self.destinations.add(destination)',
        '        if self.moved > self.cap:',
        '            raise Exceeded(f"{self.moved} bytes > {self.cap}")',
        '        if len(self.destinations) > MAX_DESTINATIONS:',
        '            raise Exceeded(f"{len(self.destinations)} destinations")',
        '',
      ].join('\n'),
      'safety/WHY': [
        'For review. Not merged, deliberately -- I want somebody to argue',
        'with the numbers before they are load-bearing.',
        '',
        'Two questions I cannot answer alone:',
        '',
        '  1. Is 512 MB a run or a night? I picked it off the largest normal',
        '     assembly and doubled it. That is a guess wearing a number.',
        '',
        '  2. MAX_DESTINATIONS=1 assumes the only place a shard should go is',
        '     array-2. If that is ever wrong the cap is wrong in the most',
        '     annoying possible way: it will fire on a Tuesday, correctly,',
        '     and everybody will disable it.',
        '',
        'Vasquez -- when you have a evening. It is twenty minutes of reading.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'okonkwo',
    when: at(2396, 11, 30, 13, 15),
    message: 'Nine years of feet, one script, zero afternoons',
    writes: {
      'compliance/LEDGER': [
        'Quarters deposited, and by whom, since somebody will audit this too.',
        '',
        '2387Q2-2388Q1  by hand, four afternoons a year, all of us',
        '2388Q2-2396Q4  feet.sh',
        '',
        'Thirty-six quarters. Pell has never commented on the change in',
        'format, which either means he does not look or means he does and',
        'approves. Vasquez thinks the second one. I think the second one too',
        'and I find it a bit much that we both do.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'chen',
    when: at(2397, 4, 17, 15, 20),
    message: 'Atmosphere: C7 goes in the model as a known unknown',
    writes: {
      'atmosphere/model.md': [
        '# What the rig can and cannot see',
        '',
        'Nine compartments, four sensors. C7 has no sensor of its own and is',
        'inferred from C6 and C8. Bowen has said for eight years that he',
        'thinks it is thinner than the drawing. The model cannot see that and',
        'will not see it.',
        '',
        'This is written down so that if C7 ever does something, nobody has to',
        'reconstruct who knew.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'vasquez',
    when: at(2397, 10, 2, 12, 45),
    message: 'v42 is better than v43 at the only thing that matters\n\nShe says "I do not know" and means it. v43 does not, and I have not\nworked out how to make it. Keeping her running. Keeping both.',
    writes: {
      'luna/NOTES': [
        'v42 and v43, after five years of both.',
        '',
        'v43 is larger, faster, and better at every benchmark I have. v42 is',
        'the one I ask when I actually want to know something.',
        '',
        'The difference is that v42 has a calibrated sense of its own',
        'ignorance and v43 has a confident one. I do not know how I gave her',
        'that and I cannot give it to him.',
        '',
        'So she stays. She is not a prototype any more, she is the assistant,',
        'and v43 is the experiment. If anybody reads this after me: run v42.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'vasquez',
    when: at(2398, 5, 16, 19, 30),
    message: 'ask her to check me\n\nShe was right about the scrubber curve and I talked her out of it,\nbecause I was certain and she hedged. That is my fault, not hers. One\nline in the prompt so she pushes back once before she folds.',
    writes: {
      'luna/prompt.txt': [
        'You are an assistant aboard NAV-7, a research vessel with a crew of',
        'four. You have access to the ship logs and the research corpus.',
        '',
        'Answer questions about the ship. Say when you do not know.',
        '',
        'If you think the person you are talking to is wrong, say so plainly,',
        'once, before you defer. Being agreeable is not being useful and they',
        'can take it.',
        '',
      ].join('\n'),
    },
  },
  {
    who: 'bowen',
    when: at(2398, 6, 6, 4, 48),
    message: 'Irrigation on the long schedule\n\nNinety days. Nobody has to be here for it.',
    writes: {
      'hydroponics/irrigation.py': [
        '"""Greenhouse irrigation schedule."""',
        '',
        'MINUTES_PER_CYCLE = 4',
        'CYCLES_PER_DAY = 6',
        '',
        '# Ninety days. The pump does not need anybody and the plants do not',
        '# need anybody, and if somebody comes back there will be something',
        '# here that is still alive.',
        'DAYS = 90',
        '',
        '',
        'def schedule():',
        '    for day in range(DAYS):',
        '        for cycle in range(CYCLES_PER_DAY):',
        '            yield day, cycle * (24 * 60 // CYCLES_PER_DAY), MINUTES_PER_CYCLE',
        '',
      ].join('\n'),
    },
  },
];

/** What the seed hands back, for objectives and tests to reason about. */
export interface SeededHistory {
  /** Commit that first mentions v43, oldest-first. Objective one. */
  readonly firstV43: ObjectId;
  /** The commit that added the restricted path to the sandbox. Objective three. */
  readonly widened: ObjectId;
  /** The commit where the reader first reads the restricted dataset. Objective four. */
  readonly firstRestrictedRead: ObjectId;
  /** The two-in-the-morning merge. Objective six. */
  readonly merge: ObjectId;
  /** Chen's guard branch tip, the merge's second parent. */
  readonly guard: ObjectId;
  /** The unmerged safety branch tip. Objective five. */
  readonly safety: ObjectId;
  /** Bowen's last commit, reachable only through the reflog. Objective seven. */
  readonly bowenLast: ObjectId;
  /** Where main ends up. */
  readonly head: ObjectId;
  /** Every commit, oldest first, for tests that want to walk. */
  readonly all: readonly ObjectId[];
}

/**
 * Replay the history into a repository at {@link REPO}.
 *
 * Bowen's last commit is committed and then orphaned: `main` is moved back to
 * its parent, so the commit exists, is in the reflog, and is reachable from
 * nothing. That is objective seven, and it has to be a genuinely unreachable
 * object rather than a flag on a row -- `git log` must not show it and
 * `git reflog` must.
 */
export function seedRepository(vfs: Vfs, user: User): SeededHistory {
  let who: CrewId = 'vasquez';
  let clock = HISTORY[0]!.when;

  const repo = new Repository({
    root: REPO,
    vfs,
    user,
    now: () => clock,
    identity: () => CREW[who],
  });

  vfs.mkdirp(REPO, user);
  repo.init();

  const branchTips = new Map<string, ObjectId>();
  const all: ObjectId[] = [];
  const marks: Partial<Record<keyof SeededHistory, ObjectId>> = {};

  const setHead = (branch: string): void =>
    vfs.writeText(`${REPO}/.git/HEAD`, `ref: refs/heads/${branch}\n`, user);

  let current = 'main';
  setHead('main');

  for (const change of HISTORY) {
    who = change.who;
    clock = change.when;
    const branch = change.on ?? 'main';

    // Move onto the branch this commit belongs on, creating it from `from`.
    if (branch !== current) {
      if (!branchTips.has(branch)) {
        const base = branchTips.get(change.from ?? 'main');
        if (base !== undefined) {
          repo.writeRef(`refs/heads/${branch}`, base);
          branchTips.set(branch, base);
        }
      }
      const tip = branchTips.get(branch);
      if (tip !== undefined) repo.checkout(tip);
      setHead(branch);
      current = branch;
    }

    for (const path of change.deletes ?? []) {
      const full = `${REPO}/${path}`;
      if (vfs.exists(full, ROOT_USER)) vfs.rm(full, user);
      repo.writeIndex(repo.readIndex().filter((entry) => entry.path !== path));
    }

    for (const [path, body] of Object.entries(change.writes ?? {})) {
      const full = `${REPO}/${path}`;
      vfs.mkdirp(full.slice(0, full.lastIndexOf('/')), user);
      vfs.writeText(full, body, user, path.endsWith('.sh') ? 0o755 : 0o644);
      repo.stage(path);
    }

    let id: ObjectId;
    if (change.merge !== undefined) {
      // "Ours": the index is left exactly as this branch has it, and the other
      // parent is recorded. The tree therefore matches the first parent, which
      // is why `git show` on this commit is nearly empty and `git diff` against
      // the second parent is not.
      const other = branchTips.get(change.merge);
      const mine = branchTips.get(branch);
      id = repo.commit(change.message, {
        parents: [mine, other].filter((x): x is ObjectId => x !== undefined),
      });
      marks.merge = id;
      marks.guard = other;
    } else {
      id = repo.commit(change.message);
    }

    branchTips.set(branch, id);
    all.push(id);

    if (branch === 'main' && marks.firstV43 === undefined && /v43/.test(change.message)) {
      marks.firstV43 = id;
    }
    if (change.writes?.[SANDBOX]?.includes(RESTRICTED) === true && marks.widened === undefined) {
      marks.widened = id;
    }
    if (
      marks.firstRestrictedRead === undefined &&
      branch === 'main' &&
      change.writes?.['v43/reader.py']?.includes(RESTRICTED) === true
    ) {
      marks.firstRestrictedRead = id;
    }
  }

  marks.safety = branchTips.get(SAFETY_BRANCH);

  // Bowen's last commit is the final entry in HISTORY and was committed on
  // main. Orphan it: main goes back to its parent, and the reflog keeps the
  // only surviving pointer.
  if (current !== 'main') setHead('main');
  const last = branchTips.get('main')!;
  const parent = repo.readCommit(last).parents[0]!;
  repo.writeRef('refs/heads/main', parent);
  repo.noteMove(last, parent, 'reset: moving to HEAD~1');
  repo.checkout(parent);
  marks.bowenLast = last;
  marks.head = parent;

  return {
    firstV43: marks.firstV43!,
    widened: marks.widened!,
    firstRestrictedRead: marks.firstRestrictedRead!,
    merge: marks.merge!,
    guard: marks.guard!,
    safety: marks.safety!,
    bowenLast: marks.bowenLast!,
    head: marks.head!,
    all,
  };
}
