import type { CompanionOptions } from '@sigkill/quest';

/**
 * Merrick, when asked.
 *
 * Topics are people and places in the town, never the next query. A clerk who
 * answered "how do I find the crew" would be a hint ladder with a name on it,
 * and the act already has one of those behind `hint`. What she can do that
 * the ladder cannot is say who these people are to her.
 */
export const COMPANION: CompanionOptions = {
  speaker: 'MERRICK',
  topics: {
    here: [
      'Twenty people in the queue. Four of us at the counter. One system designed for neither.',
    ],
    crew: [
      'I can help you find their records. Tell me their names as people, if you want.',
    ],
    paperwork: [
      'People leave things blank when they do not know. The database calls that NULL. At least it admits it.',
    ],
    kerr: [
      'Kerr is the adjuster. She reads every row and she has never once been wrong about what one said.',
      'She is not on anybody\'s side. That is the most useful thing about her.',
    ],
    hollis: [
      'Hollis towed you in. Comes to the counter every morning to ask about you and pretends it is about the invoice.',
    ],
    pell: [
      'Pell paid for your ship for eleven years and has written to this office about feet more often than I can say aloud.',
      'He is ridiculous. He is also the only person in this town who has never lied on a form.',
    ],
    vasquez: [
      'I never met her. I have read everything she ever filed, which on this job is closer than meeting someone.',
      'She started a great many things and finished most of them.',
    ],
    yard: [
      'Four hundred and twelve vessels in bond. Yours is the only one with somebody standing outside it.',
    ],
    card: [
      'Public terminals load registered instances only. I have seen what loads when they do not.',
      'Ask the archive what it has on the name on that card. Registrations are filings.',
    ],
  },
  asides: {},
};
