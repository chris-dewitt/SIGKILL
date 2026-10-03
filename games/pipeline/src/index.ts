import type { Adventure } from '@sigkill/quest';
import { bootPipeline, restorePipeline } from './world.js';
export { bootPipeline, restorePipeline, PIPELINE_OBJECTIVES } from './world.js';
export const PIPELINE: Adventure = {
  id:'pipeline', number:7, title:'The Pipeline', teaches:'Data pipelines, retries and backfills',
  blurb:['The scanner sent it three times.', 'Someone was charged for all three.', 'Keep the events. Lose the duplicates.'],
  boot:async()=>bootPipeline(), restore:async snapshot=>restorePipeline(snapshot),
  coldOpen:()=>[
    '  FERRYMAN\'S REST — INTAKE DESK',
    'MERRICK: New job. Same building. The scanner thinks everyone deserves three invoices.',
    'MERRICK: Keep the original. Fix the export. Leave me something I can run tomorrow.',
    'LUNA: A pipeline. I was promised there would be pipes.',
    '  cat README     objectives     hint     talk',
  ],
  epilogue:()=>[
    'MERRICK: Four events. Two claims. One rejected row waiting for its sender.',
    'MERRICK: The retry changed nothing. The late delivery counted. Nobody pays twice.',
    'LUNA: Tomorrow\'s batch gets the recipe. You get lunch.',
    '', '  THE PIPELINE — COMPLETE', '  Keep experimenting, or type games.', '',
  ],
};
