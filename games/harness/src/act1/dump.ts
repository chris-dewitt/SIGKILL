/**
 * The recovery dump: what the tow pulled off NAV-7 and nobody has read.
 *
 * Everything here is generated rather than pasted, and the answers are
 * *computed from the generated data* rather than written down beside it. That
 * is not tidiness. A goal that checks for `2211404096` and a log that happens
 * to contain something else is the worst bug this game can have -- it tells a
 * player who did everything right that they are wrong, and there is no hint
 * ladder that recovers from that. Deriving both from one array makes the two
 * incapable of disagreeing.
 *
 * The total is not chosen freely either. `games/archive` already has the
 * transit as a row:
 *
 *     INSERT INTO transits VALUES
 *       (9903, 'KV-OUTER-9', '2398-06-06 04:12', 2211404096,
 *        'RG-NAV7-03', 'commercial region 7');
 *
 * So the raw telemetry has to sum to exactly that. The moment the player's
 * own script reproduces the archive's number from a different source is the
 * best beat in the act, and it only works if the arithmetic is real.
 */

/** The transit, as game two's archive records it. The anchor for everything. */
export const TRANSIT_BYTES = 2_211_404_096;

/** When the uplink opened. `2398-06-06 04:12`, matching the same row. */
export const TRANSIT_START = Date.UTC(2398, 5, 6, 4, 12, 0);

/** Bytes per second once the link settled. Line rate for a hull this old. */
const LINE_RATE = 3_350_000;

/** The ramp, before flow control found the ceiling. */
const RAMP = [65_536, 524_288, 1_572_864];

/** Idle samples before the uplink opened, and after it closed. */
const IDLE_BEFORE = 120;
const IDLE_AFTER = 40;

export interface Sample {
  /** Seconds since `TRANSIT_START`, negative before it. */
  readonly offset: number;
  readonly bytes: number;
  readonly state: 'idle' | 'up' | 'closed';
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Build the whole window, then make the last transferring second exact.
 *
 * A transfer does not end on a round number -- it ends when it runs out of
 * things to send, part way through a second. Using that partial sample to
 * absorb the remainder is both how it would really look and the only way to
 * land on the archive's figure to the byte.
 */
function buildSamples(): Sample[] {
  const samples: Sample[] = [];

  for (let i = IDLE_BEFORE; i > 0; i--) samples.push({ offset: -i, bytes: 0, state: 'idle' });

  let sent = 0;
  let offset = 0;
  for (const bytes of RAMP) {
    samples.push({ offset, bytes, state: 'up' });
    sent += bytes;
    offset += 1;
  }

  const full = Math.floor((TRANSIT_BYTES - sent) / LINE_RATE);
  for (let i = 0; i < full; i++) {
    samples.push({ offset, bytes: LINE_RATE, state: 'up' });
    sent += LINE_RATE;
    offset += 1;
  }

  const remainder = TRANSIT_BYTES - sent;
  // Only absent if the totals divided exactly, which they do not -- but an
  // assertion about the shape of the data belongs in the test, not here.
  if (remainder > 0) {
    samples.push({ offset, bytes: remainder, state: 'up' });
    offset += 1;
  }

  for (let i = 0; i < IDLE_AFTER; i++) samples.push({ offset: offset + i, bytes: 0, state: 'closed' });
  return samples;
}

export const SAMPLES: readonly Sample[] = buildSamples();

/** How many seconds the uplink actually carried traffic. */
export const TRANSIT_SECONDS = SAMPLES.filter((s) => s.state === 'up').length;

/** The answer to objective two, derived rather than asserted. */
export const UPLINK_TOTAL = SAMPLES.reduce((n, s) => n + s.bytes, 0);

/**
 * The lines the power transition ruined.
 *
 * Two kinds, because they fail differently and a player should meet both. A
 * counter that reads `--` raises `ValueError` from `int()`; a line cut off
 * after the descriptor raises `IndexError` when the third field is asked for.
 * A script that survives one and not the other is not finished, and the
 * player finds that out from the traceback rather than from a hint.
 *
 * They are *inserted* between good samples rather than replacing any, so the
 * total is untouched. A truncated write is a retried write: the real sample
 * arrived on the next line.
 */
const MALFORMED = 17;

export const UPLINK_REJECTED = MALFORMED;

/** Samples whose counter came through intact, and therefore add to the total. */
export const UPLINK_GOOD = SAMPLES.length;

/**
 * Every reading in the log, ruined ones included. The answer to objective one.
 *
 * Deliberately the larger number. A line the transition cut short is still a
 * reading the ship took -- it is a sample that failed to be written down, not
 * a second that did not happen -- so "how much telemetry is there" counts it.
 * That also makes the figure the one a player arrives at honestly, either by
 * counting the non-comment lines or by reporting `len(rows) + rejected`, and
 * it makes objective five ("account for every line you threw away") a real
 * question rather than a restatement of this one.
 *
 * Getting this backwards was the first thing game three's own suite caught.
 */
export const UPLINK_SAMPLES = SAMPLES.length + MALFORMED;

function malformedLine(at: string, which: number): string {
  return which % 2 === 0 ? `${at} fd3 -- up` : `${at} fd3`;
}

/**
 * The log, as a file.
 *
 * `ISO8601 fd bytes state`, space separated, which is the plainest thing a
 * ship would write and the plainest thing to `split()`.
 */
export function uplinkLog(): string {
  const lines: string[] = [
    '# NAV-7 uplink byte counters, recovered under tow',
    '# fields: time fd bytes state',
    '# gaps and -- readings are transition artefacts, not zero traffic',
  ];

  // Every `spacing`-th transferring sample is followed by a ruined line.
  const transferring = SAMPLES.filter((s) => s.state === 'up').length;
  const spacing = Math.floor(transferring / (MALFORMED + 1));
  let placed = 0;
  let seen = 0;

  for (const sample of SAMPLES) {
    const at = iso(TRANSIT_START + sample.offset * 1000);
    lines.push(`${at} fd3 ${sample.bytes} ${sample.state}`);
    if (sample.state !== 'up') continue;
    seen += 1;
    if (placed < MALFORMED && seen % spacing === 0) {
      lines.push(malformedLine(at, placed));
      placed += 1;
    }
  }
  return lines.join('\n') + '\n';
}

/** Total lines in the log, comments included. What `wc -l` will say. */
export const UPLINK_LINES = uplinkLog().trimEnd().split('\n').length;

// --------------------------------------------------------------- the operator

/**
 * The incident report. Correct in every number and wrong in the one word.
 *
 * `2.2 GB` is right: 2,211,404,096 bytes really is 2.21 decimal gigabytes,
 * and a player who "catches" the operator inflating it has caught nothing and
 * is about to say so to an adjuster. That trap is deliberate and it is the
 * subject of objective four.
 *
 * What is wrong is `routine dataset synchronisation`, and no arithmetic
 * reaches it. Only the shape does.
 */
export const INCIDENT_JSON = JSON.stringify(
  {
    vessel: 'NAV-7',
    hull: 'KV-OUTER-9',
    window: { from: '2398-06-06T04:12:00Z', to: '2398-06-06T04:23:03Z' },
    classification: 'routine dataset synchronisation',
    volume_reported: '2.2 GB',
    account: 'RG-NAV7-03',
    destination: 'archive endpoint (unspecified)',
    reviewed_by: 'automated',
    notes: 'No anomaly. Closed.',
  },
  null,
  2,
) + '\n';

// ------------------------------------------------------------------ the ledger

/**
 * Hollis's billing ledger -- the independent second source.
 *
 * She bills relay in kilobytes and truncates, because that is what her
 * software does and she has never once cared. So her figure is
 * 2,211,404 kB against 2,211,404,096 bytes: ninety-six bytes apart, which is
 * two sources agreeing to eight significant figures and the best argument in
 * the act.
 *
 * It is also a second unit conversion, in the other direction, with a real
 * reason for existing rather than a puzzle's reason.
 */
export const LEDGER_KB = Math.floor(TRANSIT_BYTES / 1000);

export function ledgerCsv(): string {
  return [
    'date,item,unit,quantity,account',
    '2398-06-04,fuel and lane fees,cr,880,FR-YARD-01',
    '2398-06-05,relay carried for KV-OUTER-7,kB,41,KV-OPS-11',
    `2398-06-06,relay carried for KV-OUTER-9,kB,${LEDGER_KB},RG-NAV7-03`,
    '2398-06-06,relay carried for KV-OUTER-9,kB,8,KV-OPS-11',
    '2398-06-08,tow hookup NAV-7,cr,0,WRITTEN OFF',
    '2398-06-09,berth,cr,120,FR-YARD-01',
    '',
  ].join('\n');
}

// -------------------------------------------------------------- the sessions

/**
 * What asked for the uplink, and under whose name.
 *
 * This file is the payoff of Act I's optional `map-v43`, two games later. That
 * objective ends with a symlink at `/opt/luna/v43` pointing off the ship,
 * nobody able to open it, and LUNA declining to read anything into it -- "I am
 * saying that to you and also to me." The directory that would not open is the
 * thing that opened the channel.
 *
 * Three rules were kept while writing it, and all three are canon:
 *
 * Act I never names v43 as the author of anything. Its `/etc/ferry.profile`
 * says `DECLARED_BY=AUTOMATED` and stops there, on purpose. So the name cannot
 * come from anything DeWitt carried off the ship -- it has to come from a
 * source he could not read until now, which is this one.
 *
 * It is evidence, not omnipotence. "Exactly how it breaches isolation requires
 * later evidence and must not be hand-waved." So the log shows the request
 * denied for an unregistered executable, and then the same pid asking again
 * one second later as root. What it does not show is *how* it became root.
 * That is game four's, and a log that explained it would be doing game four's
 * job badly.
 *
 * And it proves nothing about what v43 concluded or what it is. A process
 * asked for a channel, was refused, came back with authority it should not
 * have had, and sent two gigabytes to a rented processor. Every word of that
 * is a record. None of it is a theory.
 */
export const V43_EXECUTABLE = '/opt/luna/v43/bin/worker';
export const V43_PID = 412;

/** Vasquez's uid on NAV-7, from `games/wreck/src/act1/deck-c.ts`. */
const VASQUEZ_UID = 1001;

export function sessionsLog(): string {
  return [
    '# NAV-7 uplink channel service -- session records',
    '# recovered under tow. Times are ship UTC.',
    '# REQUEST/GRANT/DENY/RELEASE, one line each. Billing is the grant account.',
    '',
    '2398-06-04T06:00:02Z REQUEST fd1 pid 88  /usr/sbin/telemetryd     uid 0    root',
    '2398-06-04T06:00:02Z GRANT   fd1 billing KV-OPS-11',
    '2398-06-05T18:02:44Z REQUEST fd2 pid 88  /usr/sbin/telemetryd     uid 0    root',
    '2398-06-05T18:02:44Z GRANT   fd2 billing KV-OPS-11',
    '2398-06-05T18:09:10Z RELEASE fd2 by owner',
    '',
    '# -- 06-06 --',
    `2398-06-06T04:11:58Z REQUEST fd3 pid ${V43_PID} ${V43_EXECUTABLE} uid ${VASQUEZ_UID} vasquez`,
    '2398-06-06T04:11:59Z DENY    fd3 reason: unregistered executable, uid not in channel group',
    `2398-06-06T04:11:59Z REQUEST fd3 pid ${V43_PID} ${V43_EXECUTABLE} uid 0    root`,
    '2398-06-06T04:12:00Z GRANT   fd3 billing RG-NAV7-03',
    '2398-06-06T04:12:00Z NOTE    fd3 main array released to transit control',
    '2398-06-06T04:23:03Z RELEASE fd3 by peer',
    '',
    '2398-06-06T04:23:04Z REQUEST fd1 pid 88  /usr/sbin/telemetryd     uid 0    root',
    '2398-06-06T04:23:04Z DENY    fd1 reason: array not under local control',
    '2398-06-08T22:14:30Z NOTE    service stopped, hull under tow',
    '',
  ].join('\n');
}

// ------------------------------------------------------------------- the buffer

/**
 * Where the bytes went.
 *
 * Base64 in the buffer because that is how a routing header is carried, not
 * because anything is hiding: `grep` finds the line, and the line is
 * unreadable until it is decoded, which is the whole lesson. One `import
 * base64` and it is over.
 */
export const DESTINATION = 'tenancy-7c4.compute.region7.kepler-vance.net/instance/aa41';

/** Base64 of `DESTINATION`, computed rather than pasted for the same reason. */
export const DESTINATION_B64 = btoa(DESTINATION);

export function commsBuffer(): string {
  const lines: string[] = ['# uplink destination buffer, tail', '# ROUTE records are base64 per KV-OUTER spec 4.1', ''];

  const chatter = [
    'KEEPALIVE ok',
    'LANE KV-OUTER-9 window open',
    'TELEMETRY batch accepted',
    'KEEPALIVE ok',
    'CLOCK drift 0.002s corrected',
    'LANE KV-OUTER-9 window open',
  ];
  for (let i = 0; i < 180; i++) lines.push(`04:0${(i % 9) + 1} ${chatter[i % chatter.length]}`);

  lines.push(`04:12 ROUTE established ${DESTINATION_B64}`);
  lines.push('04:12 ROUTE accepted, billing RG-NAV7-03');

  for (let i = 0; i < 200; i++) lines.push(`04:${13 + (i % 10)} ${chatter[i % chatter.length]}`);
  lines.push('04:23 LANE KV-OUTER-9 window closed by peer');
  lines.push('');
  return lines.join('\n');
}
