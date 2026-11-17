import type { Adventure, World } from '@sigkill/quest';
import { bootPipeline, restorePipeline, PIPELINE_OBJECTIVES } from './world.js';
export { bootPipeline, restorePipeline, INTAKE_MS, PIPELINE_OBJECTIVES } from './world.js';
/** Whether one of this act's objectives holds in the world -- what every gauge below reads. */
const met = (id: string, world: World): boolean =>
  PIPELINE_OBJECTIVES.find((o) => o.id === id)?.done(world) === true;

export const PIPELINE: Adventure = {
  place: "FERRYMAN'S REST — INTAKE DESK",
  conditions: (world) => [
    met('publish', world)
      ? { label: 'OUTBOX', value: 'current', tone: 'good' }
      : { label: 'OUTBOX', value: 'stale', tone: 'warn' },
    met('safe-to-repeat', world)
      ? { label: 'REPLAY', value: 'safe', tone: 'good' }
      : { label: 'REPLAY', value: 'untested', tone: 'warn' },
  ],
  id:'pipeline', number:6, title:'The Pipeline', teaches:'Data pipelines and backfills',
  blurb:['The scanner sent it three times.', 'Someone was charged for all three.', 'Keep the events. Lose the duplicates.'],
  boot:async()=>bootPipeline(), restore:async snapshot=>restorePipeline(snapshot),
  coldOpen:()=>[
    '  FERRYMAN\'S REST — INTAKE DESK',
    'MERRICK: New job. Same building. The scanner thinks everyone deserves three invoices.',
    'MERRICK: Keep the original. Fix the export. Leave me something I can run tomorrow.',
    'LUNA: A pipeline. I was promised there would be pipes.',
    'MERRICK: The README is on your desk. I wrote it before the coffee.',
  ],
  epilogue:()=>[
    'MERRICK: Four events. Two claims. One rejected row waiting for its sender.',
    'MERRICK: The retry changed nothing. The late delivery counted. Nobody pays twice.',
    'LUNA: Tomorrow\'s batch gets the recipe. You get lunch.',
    '', '  THE PIPELINE — COMPLETE', '  Keep experimenting, or type games for The Containment.', '',
  ],
};
