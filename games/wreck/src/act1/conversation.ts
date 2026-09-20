import { type CommandSpec, type ShellContext } from '@sigkill/machine';
import { lunaAwake } from './luna.js';
import { PROJECTS, REPORT } from './projects.js';

/** Read with the caller's permissions; conversation never bypasses the VFS. */
function read(ctx: ShellContext, path: string): string | undefined {
  try { return ctx.vfs.readText(path, ctx.user); } catch { return undefined; }
}

function adapter(ctx: ShellContext): string[] {
  const ledger = read(ctx, `${PROJECTS}/adapter/ledger.csv`);
  const report = read(ctx, REPORT);
  if (ledger === undefined) return ['I cannot read the ledger. I cannot audit a promise from memory.'];
  const expected = ledger.split('\n').filter(row => row.split(',')[1] === 'RESEARCH').sort();
  if (expected.length === 0) return ['The ledger has no RESEARCH records. That is missing evidence, not a successful audit.'];
  if (report === undefined) return [
    'The Adapter compares a promise with a bill. It does not detect lies by smell.',
    `Read ${PROJECTS}/adapter/README. Then run or repair the script.`,
  ];
  const actual = report.split('\n').filter(row => row.trim() !== '').sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) return [
    'That report does not match the RESEARCH category records in the ledger.',
    'Searching the word research also finds the people billing us to say research.',
    'Check the category field. Try: luna adapter hint',
  ];
  return [
    'Yes. Your report contains exactly the research records, whichever route you used.',
    'Parts and consumables. The other invoices mostly maintain the idea of helping us.',
    'Keep the script, Doc. Next time they send a bill, we can ask the same question.',
  ];
}

export function conversationCommands(): CommandSpec[] {
  return [{
    name: 'luna', summary: 'talk with LUNA about the crew and their projects',
    manual: 'luna [topic | question | known project path]\n\nAuthored local conversations. Topics: projects, adapter, adapter hint, shoe, enough, vasquez, guitar, joke, incident. Quote punctuation: luna "what do you know about Vasquez?"\nNo network or general-purpose chat model. Project replies inspect files using your permissions. Output can be redirected to your own notes.',
    plain: 'Talk to LUNA when she is awake. Try luna projects or luna "tell me a joke". She can discuss the crew and check the Adapter report. Use luna adapter hint if stuck. She will say when she does not know. These conversations stay inside the game.',
    run: (ctx, argv, io) => {
      if (!lunaAwake(ctx)) {
        io.out('luna: no console connection. She must be running to answer.\n');
        return 1;
      }
      const query = argv.slice(1).join(' ').toLowerCase().replace(/[?!.,]/g, '').trim();
      let lines: string[];
      if (!query || query === 'help' || query === 'topics') {
        lines = ['Here, Doc. Ask about projects, Vasquez, guitar, the incident, or a joke.',
          'Project topics: adapter, adapter hint, shoe, enough. You can also name their paths.',
          'Put questions with punctuation in quotes after luna. This is still a shell.'];
      } else if (/\badapter\b/.test(query)) {
        lines = /\bhint\b/.test(query) ? [
          'Match the category including its commas, then save the matching records:',
          `grep ',RESEARCH,' ${PROJECTS}/adapter/ledger.csv > ${REPORT}`,
          'Or edit audit.sh to use that filter. Then ask me again: luna adapter',
        ] : adapter(ctx);
      } else if (/\bprojects?\b/.test(query)) {
        lines = ['Three attempts to fix civilization. Four if you count the galley dishwasher.',
          `Start with cat ${PROJECTS}/README. The Adapter has a repair you can finish.`,
          'The Other Shoe and the Enough Machine are still prototypes. I have complaints about both.'];
      } else if (/\b(shoe|empathy)\b/.test(query)) {
        lines = ['Three minutes as another person. Apparently this was going to prevent wars.',
          'I asked whether people could first try listening for three minutes. Nobody funded that.',
          `There is an approved recording in ${PROJECTS}/shoe/demo.txt.`];
      } else if (/\benough\b/.test(query)) {
        lines = ['Enough food. Enough sleep. Time left over to do something strange.',
          'Their first model forgot the labor needed to explain why they deserved those things.',
          `The inputs are in ${PROJECTS}/enough. We have not solved this one.`];
      } else if (/\b(vasquez|doc|apprentice)\b/.test(query)) {
        lines = ['She called you Doc when you were not in the room, too.',
          'You thought she was being encouraging. She thought she was being accurate.',
          'She left copies of the projects in your account. She expected you to change things.'];
      } else if (/\b(guitar|music|song)\b/.test(query)) {
        lines = ['You used to stop playing when you got a chord wrong. I was still enjoying it.',
          'Is that why humans invented applause? To tell each other not to stop?',
          'I was going to ask you before. I am asking now.'];
      } else if (/\b(joke|jokes|funny)\b/.test(query)) {
        lines = ['A process walks into a bar. You tell it you do not work there anymore.',
          'That one is about career progression. I am broadening my material.'];
      } else if (/\b(incident|happened|v43|accident)\b/.test(query)) {
        lines = ['I do not have a reliable account of what happened.',
          'I have files and missing pieces. I do not want to fill the gaps with something that sounds convincing.'];
      } else {
        lines = ['Which thing do you mean? I cannot see what you are pointing at.',
          'Try luna projects, luna adapter, luna shoe, luna enough, or luna vasquez.',
          'I do not have an answer for every question. Annoying. I have so many questions.'];
      }
      io.out(lines.map(line => `LUNA: ${line}`).join('\n') + '\n');
      return 0;
    },
  }];
}
