import { Machine, Network, type HttpResponse } from '@sigkill/machine';

/**
 * The Certification Registry: a different institution, behind a service.
 *
 * The archive copies certifications from here every night, which is why it
 * has a `certifications` table at all. The registry is the source; the archive
 * is a copy; and the registry last heard from NAV-7 at 18:00 on the fifth of
 * June, the evening before. So it still lists all five of them as active,
 * with a timestamp it is perfectly confident about.
 *
 * Neither is lying. That is the lesson the design doc asked for -- two sources
 * of truth is not a bug in one of them -- and it is also where the one fact
 * the archive does not hold lives: the registry tracks apprentice hours, and
 * DeWitt's are logged, assessed and complete. Not a certificate. Evidence
 * that the only thing missing was the form.
 *
 * Paginated, two to a page, because the page he needs is the last one and a
 * player who reads page one and stops has met the most common way an API
 * lies to you: by being entirely correct about the part you asked for.
 *
 * Read-only and stateless -- a pure function of the path -- so a save needs
 * nothing from it and a restore simply builds it again.
 */

export const REGISTRY_HOST = 'registry';
export const REGISTRY_URL = `http://${REGISTRY_HOST}`;
export const CREW_ENDPOINT = '/v1/vessels/KV-1140/crew';

/** When the registry last heard anything about NAV-7. */
const AS_OF = '2398-06-05T18:00:00Z';

interface Member {
  readonly engaged: string;
  readonly name: string;
  readonly role: string;
  readonly certificate: string | null;
  readonly hours?: { logged: number; required: number; assessed_by: string; assessment: string };
}

const CREW: readonly Member[] = [
  { engaged: 'KV-7712', name: 'vasquez', role: 'engineering', certificate: 'KV-4471-E' },
  { engaged: 'KV-7713', name: 'chen', role: 'medical', certificate: 'KV-2210-M' },
  { engaged: 'KV-7714', name: 'okonkwo', role: 'cargo', certificate: 'KV-9938-C' },
  { engaged: 'KV-7715', name: 'bowen', role: 'navigation', certificate: 'KV-1174-N' },
  {
    engaged: 'KV-9902',
    name: 'dewitt',
    role: 'apprentice',
    certificate: null,
    hours: { logged: 2140, required: 2000, assessed_by: 'vasquez', assessment: 'complete' },
  },
];

const PER_PAGE = 2;
const PAGES = Math.ceil(CREW.length / PER_PAGE);

/**
 * One crew member per line.
 *
 * Valid JSON, laid out so `grep` is a reasonable tool for it -- the act
 * teaches SQL, not JSON parsing, and a player who greps for their own name
 * and gets the whole record has used the right tool for a small answer.
 */
function member(m: Member): string {
  const fields: string[] = [
    `"engaged": "${m.engaged}"`,
    `"name": "${m.name}"`,
    `"role": "${m.role}"`,
    '"status": "active"',
    `"certificate": ${m.certificate === null ? 'null' : `"${m.certificate}"`}`,
  ];
  if (m.hours) {
    fields.push(
      `"hours_logged": ${m.hours.logged}`,
      `"hours_required": ${m.hours.required}`,
      `"assessed_by": "${m.hours.assessed_by}"`,
      `"assessment": "${m.hours.assessment}"`,
    );
  }
  return `    { ${fields.join(', ')} }`;
}

function json(status: number, lines: string[]): HttpResponse {
  return { status, body: `${lines.join('\n')}\n`, contentType: 'application/json' };
}

export function registryHandler(path: string): HttpResponse {
  const [route = '/', query = ''] = path.split('?');
  const clean = route.replace(/\/+$/, '') || '/';
  const params = new Map(
    query.split('&').filter(Boolean).map((pair) => {
      const [k = '', v = ''] = pair.split('=');
      return [k, v] as const;
    }),
  );

  if (clean === '/') {
    return json(200, [
      '{',
      '  "service": "Ferryman\'s Rest Certification Registry",',
      '  "endpoints": [',
      `    "${CREW_ENDPOINT}?page=N",`,
      '    "/v1/certificates/{number}"',
      '  ]',
      '}',
    ]);
  }

  if (clean === CREW_ENDPOINT) {
    const raw = params.get('page') ?? '1';
    const page = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!(page >= 1 && page <= PAGES)) {
      return json(404, ['{', `  "error": "no page ${raw}; pages run 1 to ${PAGES}"`, '}']);
    }
    const rows = CREW.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    return json(200, [
      '{',
      '  "vessel": "KV-1140",',
      `  "as_of": "${AS_OF}",`,
      `  "page": ${page},`,
      `  "pages": ${PAGES},`,
      '  "crew": [',
      rows.map(member).join(',\n'),
      '  ],',
      `  "next": ${page < PAGES ? `"${CREW_ENDPOINT}?page=${page + 1}"` : 'null'}`,
      '}',
    ]);
  }

  const cert = /^\/v1\/certificates\/([A-Za-z0-9-]+)$/.exec(clean);
  if (cert) {
    const holder = CREW.find((m) => m.certificate === cert[1]);
    if (!holder) {
      return json(404, ['{', `  "error": "no certificate ${cert[1]}"`, '}']);
    }
    return json(200, [
      '{',
      `  "certificate": "${holder.certificate}",`,
      `  "holder": "${holder.name}",`,
      `  "engaged": "${holder.engaged}",`,
      '  "status": "valid",',
      `  "as_of": "${AS_OF}"`,
      '}',
    ]);
  }

  return json(404, ['{', '  "error": "no such endpoint; GET / lists them"', '}']);
}

/**
 * The town's network: this terminal, and the registry across the square.
 *
 * Built fresh on every boot and every restore. The terminal joins it once it
 * exists, because a Machine is given its network when it is made.
 */
export function townNetwork(epoch: number): Network {
  const network = new Network();
  network.add({
    hostname: REGISTRY_HOST,
    ip: '10.40.0.2',
    machine: new Machine({ hostname: REGISTRY_HOST, epoch }),
    ports: { 80: 'registryd/2.4' },
    accounts: {},
    http: registryHandler,
  });
  return network;
}

export function joinTown(network: Network, terminal: Machine): void {
  network.add({ hostname: 'ferryman', ip: '10.40.0.14', machine: terminal, ports: {}, accounts: {} });
}
