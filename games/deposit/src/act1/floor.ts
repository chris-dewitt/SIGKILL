import { Machine, Network, ROOT_USER, type NetHost, type Session, type User, type Vfs } from '@sigkill/machine';

/**
 * The machine floor of Pell's deposit office.
 *
 * Four hosts, because two is not a system and five does not fit on a phone:
 *
 *   bastion   where DeWitt sits. His account, his scripts, and LUNA.
 *   vault01   the deposit store. Files, hashes, and the access record.
 *   index01   the catalogue. Answers "where is matter 7714 filed".
 *   relay01   serves deposited material to the tribunal on request.
 *
 * Everything here is in the state Pell left it in, which is the state two
 * years of restarts leaves a thing in. Nothing is sabotaged and nobody is
 * negligent. The index has been answering 500 for a month and the check that
 * watches it has been green for a month, because the check asks curl whether
 * it succeeded and curl succeeded every time.
 */

export const HOME = '/home/dewitt';
export const WORK = `${HOME}/work`;

/** The matter number of DeWitt's own tow. He is not told; he finds out. */
export const HIS_MATTER = '7714';

/** uid/gid for the two accounts that exist on these machines. */
export const PEOPLE = { root: 0, dewitt: 1000, tribunal: 1200 } as const;

export interface Floor {
  network: Network;
  session: Session;
  bastion: Machine;
  vault: Machine;
  index: Machine;
  relay: Machine;
}

const lines = (...rows: readonly string[]): string => `${rows.join('\n')}\n`;

const unit = (m: Machine, name: string, body: readonly string[]): void => {
  m.vfs.mkdirp('/etc/systemd/system', ROOT_USER);
  m.vfs.writeText(`/etc/systemd/system/${name}.service`, lines(...body), ROOT_USER);
};

/** Every host has the same two accounts and the same sudoers. */
function accounts(m: Machine): void {
  m.vfs.mkdirp('/etc', ROOT_USER);
  m.vfs.writeText(
    '/etc/passwd',
    lines(
      'root:x:0:0:root:/root:/bin/sh',
      `dewitt:x:${PEOPLE.dewitt}:${PEOPLE.dewitt}:C. DeWitt, operations:/home/dewitt:/bin/sh`,
      `tribunal:x:${PEOPLE.tribunal}:${PEOPLE.tribunal}:Tribunal retrieval:/var/empty:/bin/sh`,
    ),
    ROOT_USER,
  );
  // He is the operator. He has root on all of it, which is the whole of the
  // act's tension: nothing here stops him, and the record remembers.
  m.vfs.writeText('/etc/sudoers', lines('dewitt ALL=(ALL) NOPASSWD: ALL'), ROOT_USER);
}

// --------------------------------------------------------------- the store

/**
 * Four hundred matters, of which the player will ever look at a handful.
 *
 * Generated rather than typed, deterministically: a deposit office with six
 * matters in it is a prop, and the one number that has to be real is how many
 * there are, because objective eight asks the player to find one.
 */
const MATTERS = Array.from({ length: 24 }, (_, i) => String(7700 + i));

function seedVault(m: Machine): void {
  accounts(m);
  m.vfs.mkdirp('/srv/deposit', ROOT_USER);
  m.vfs.mkdirp('/var/log', ROOT_USER);

  for (const matter of MATTERS) {
    const dir = `/srv/deposit/${matter}`;
    m.vfs.mkdirp(dir, ROOT_USER);
    m.vfs.writeText(`${dir}/manifest`, lines(`matter ${matter}`, 'filed 2398-05-02'), ROOT_USER);
  }

  /*
   * His own matter, filed between the others and marked no differently.
   *
   * The cold open does not say which one is his. He works it out, which is the
   * point at which the act stops being a job and starts being a test of
   * character -- and the game never says so out loud.
   */
  m.vfs.writeText(
    `/srv/deposit/${HIS_MATTER}/manifest`,
    lines(
      `matter ${HIS_MATTER}`,
      'filed 2398-05-02',
      'NAV-7, tow, contested',
      'parties: Tessaly Underwriting / C. DeWitt',
    ),
    ROOT_USER,
  );
  m.vfs.writeText(
    `/srv/deposit/${HIS_MATTER}/disclosure.txt`,
    lines('occupancy-v4 evaluation, as served in the annexe.', 'See matter record.'),
    ROOT_USER,
  );

  /*
   * The access record.
   *
   * Append-only in fiction and an ordinary file in fact, which is the honest
   * version: the player can read it, and so could anybody. Its credibility
   * comes from being written by the store rather than by the operator, and
   * `clean-hands` is the objective that rests on that distinction.
   */
  m.vfs.writeText(
    '/var/log/access.log',
    lines(
      '2398-06-30T09:14 tribunal 7701/manifest',
      '2398-07-01T11:02 tribunal 7705/manifest',
      `2398-07-02T08:40 tribunal ${HIS_MATTER}/manifest`,
      `2398-07-02T08:41 tribunal ${HIS_MATTER}/disclosure.txt`,
      '2398-07-04T16:20 tribunal 7719/manifest',
      '2398-07-09T10:05 tribunal 7702/manifest',
    ),
    ROOT_USER,
  );

  unit(m, 'store', [
    '[Unit]',
    'Description=Deposit store',
    '',
    '[Service]',
    'ExecStart=/usr/sbin/storectl',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  ]);
  m.services.enable('store');
  m.services.start('store');
}

// ------------------------------------------------------------- the catalogue

/**
 * The failure the act opens on, and it is nobody's fault.
 *
 * `catalogue` holds the index's data and died a month ago. It left a lock
 * behind. `index` is still running -- it starts fine, it answers, it looks
 * healthy to anything that only asks whether it is running -- and every
 * answer it gives is a 500 saying the catalogue is locked.
 *
 * That gap, between a service being *up* and a service being *right*, is the
 * act. `systemctl status index` has said `active` every day for a month.
 */
export const LOCK = '/var/lib/index/catalogue.lock';

function seedIndex(m: Machine): void {
  accounts(m);
  m.vfs.mkdirp('/var/lib/index', ROOT_USER);
  m.vfs.mkdirp('/etc/index', ROOT_USER);
  m.vfs.writeText(LOCK, lines('held by pid 441, 2398-07-01T02:11'), ROOT_USER);

  m.vfs.writeText(
    '/etc/index/catalogue.conf',
    lines('# Catalogue datastore', 'store=vault01:/srv/deposit', 'readers=4'),
    ROOT_USER,
  );

  unit(m, 'catalogue', [
    '[Unit]',
    'Description=Catalogue datastore',
    '',
    '[Service]',
    'ExecStart=/usr/sbin/cataloguer',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  ]);

  /*
   * `Requires=` and `After=`, written the way they are usually written -- both
   * together, naming the same unit, for two different reasons. Objective seven
   * is the player finding out that they are not the same reason.
   */
  unit(m, 'index', [
    '[Unit]',
    'Description=Matter catalogue',
    'Requires=catalogue.service',
    'After=catalogue.service',
    '',
    '[Service]',
    'ExecStart=/usr/sbin/indexd',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  ]);
  m.services.enable('catalogue');
  m.services.enable('index');

  // Both up, because `index` only requires that `catalogue` is *active*, and
  // it is. Being active is not the same as having let go of the lock.
  m.services.start('catalogue');
  m.services.start('index');
}

/**
 * What the index actually answers.
 *
 * A handler rather than files under /srv/http, because the whole point is that
 * the response depends on state the player can change: remove the lock and the
 * same URL starts answering. A static file could not teach that.
 */
export function indexHandler(path: string, host: NetHost): { status: number; body: string } {
  const locked = host.machine.vfs.exists(LOCK, ROOT_USER);
  if (locked) {
    return { status: 500, body: 'catalogue locked\n' };
  }
  if (path.startsWith('/matter/')) {
    const matter = path.slice('/matter/'.length).replace(/\/$/, '');
    return MATTERS.includes(matter)
      ? { status: 200, body: `${matter} vault01:/srv/deposit/${matter}\n` }
      : { status: 404, body: 'no such matter\n' };
  }
  return { status: 200, body: 'ok\n' };
}

// ----------------------------------------------------------------- the relay

function seedRelay(m: Machine): void {
  accounts(m);
  m.vfs.mkdirp('/srv/http', ROOT_USER);
  m.vfs.writeText('/srv/http/health', lines('ok'), ROOT_USER);
  m.vfs.mkdirp('/etc/relay', ROOT_USER);
  m.vfs.writeText(
    '/etc/relay/relay.conf',
    lines('# Tribunal retrieval', 'index=http://index01', 'workers=2'),
    ROOT_USER,
  );

  unit(m, 'relay', [
    '[Unit]',
    'Description=Tribunal relay',
    '',
    '[Service]',
    'ExecStart=/usr/sbin/relayd',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  ]);
  m.services.enable('relay');
  m.services.start('relay');
}

// --------------------------------------------------------------- the bastion

function seedBastion(m: Machine): void {
  accounts(m);
  m.vfs.mkdirp(HOME, ROOT_USER);
  m.vfs.mkdirp(WORK, ROOT_USER);
  m.vfs.mkdirp('/opt/deposit', ROOT_USER);

  /*
   * Pell's check, exactly as he wrote it, and it has never once been wrong
   * about anything.
   *
   * `curl URL && echo healthy` asks curl whether the transfer worked. The
   * transfer works. The index has been answering 500 for a month and this has
   * printed `index healthy` every morning, because an HTTP error is a
   * successful transfer and curl exits 0 unless you say `-f`.
   *
   * It is kept executable and kept working, because the player has to be able
   * to run it and watch it lie before they can be expected to care.
   */
  m.vfs.writeText(
    '/opt/deposit/check.sh',
    lines(
      '#!/bin/sh',
      '# Deposit health. -- T. Pell, 2396',
      'curl http://index01/health && echo "index healthy"',
      'curl http://relay01/health && echo "relay healthy"',
    ),
    ROOT_USER,
  );
  m.vfs.chmod('/opt/deposit/check.sh', 0o755, ROOT_USER);

  m.vfs.writeText(
    `${HOME}/PELL`,
    lines(
      'From: T. Pell, clerk',
      'To:   C. DeWitt',
      'Re:   the floor',
      '',
      'It is yours from this morning. I am not going to pretend it is in good',
      'order. I have kept it up for two years by restarting things and I never',
      'learned what any of it does, and nobody wrote any of it down.',
      '',
      'There are four machines. bastion is this one. vault01 holds the',
      'deposited material, index01 says where a thing is filed, relay01 hands',
      'it to the tribunal when they ask.',
      '',
      '/opt/deposit/check.sh is the health check. I run it every morning. It',
      'has been green every morning.',
      '',
      'One thing, and I am saying it once because the office cannot say it to',
      'you twice. Some of what is on vault01 is yours. You have root. Nobody',
      'here is going to watch you, and the store writes down every read it',
      'serves whether anybody is watching or not.',
      '',
      'Make it available. Do not make it convenient.',
      '',
      '                                                            -- T. Pell',
      '',
    ),
    ROOT_USER,
  );

  m.vfs.writeText(
    `${HOME}/README`,
    lines(
      'Deposit office, machine floor. Signed in as dewitt on bastion.',
      '',
      '  ~/PELL                   the handover',
      '  /opt/deposit/check.sh    the health check, as Pell wrote it',
      `  ${WORK}/              put what you establish in here`,
      '',
      'The other three:',
      '',
      '  ssh vault01              the deposit store',
      '  ssh index01              the catalogue',
      '  ssh relay01              the tribunal relay',
      '',
      'You have sudo everywhere. Type  objectives  for what the job is,',
      'and  hint  when you are stuck.',
      '',
    ),
    ROOT_USER,
  );
}

/** Hand the bastion's writable parts to DeWitt. */
export function ownWorkspace(vfs: Vfs, uid: number, gid: number): void {
  const chown = (path: string): void => {
    try {
      vfs.chown(path, uid, gid, ROOT_USER);
    } catch {
      // Not ours to hand over.
    }
    let kind: string;
    try {
      kind = vfs.lstat(path, ROOT_USER).kind;
    } catch {
      return;
    }
    if (kind !== 'dir') return;
    for (const name of vfs.readdir(path, ROOT_USER)) {
      chown(`${path}/${name}`.replace(/\/+/g, '/'), );
    }
  };
  chown(HOME);
}

// ------------------------------------------------------------------- the floor

export interface FloorOptions {
  /** Supplied per host by the adventure: commands, track, python. */
  wire?: (hostname: string) => Record<string, unknown>;
}

/**
 * Build the whole floor.
 *
 * One `Network` and one `Session` shared by every machine, which is what makes
 * `ssh` a hop rather than a simulation of one.
 */
export function seedFloor(make: (hostname: string) => Machine): Floor {
  const bastion = make('bastion');
  const vault = make('vault01');
  const index = make('index01');
  const relay = make('relay01');

  seedBastion(bastion);
  seedVault(vault);
  seedIndex(index);
  seedRelay(relay);
  ownWorkspace(bastion.vfs, PEOPLE.dewitt, PEOPLE.dewitt);

  return {
    network: bastion.network!,
    session: bastion.session,
    bastion,
    vault,
    index,
    relay,
  };
}

/** The hosts, their addresses and what each one answers on. */
export const HOSTS = [
  {
    hostname: 'bastion',
    ip: '10.2.0.1',
    ports: { 22: 'SSH-2.0-OpenSSH_9.6' },
    accounts: { dewitt: { uid: PEOPLE.dewitt, gid: PEOPLE.dewitt } },
  },
  {
    hostname: 'vault01',
    ip: '10.2.0.10',
    ports: { 22: 'SSH-2.0-OpenSSH_9.6' },
    accounts: {
      dewitt: { uid: PEOPLE.dewitt, gid: PEOPLE.dewitt },
      root: { uid: 0, gid: 0 },
    },
  },
  {
    hostname: 'index01',
    ip: '10.2.0.20',
    ports: { 22: 'SSH-2.0-OpenSSH_9.6', 80: 'indexd/2.1' },
    accounts: {
      dewitt: { uid: PEOPLE.dewitt, gid: PEOPLE.dewitt },
      root: { uid: 0, gid: 0 },
    },
  },
  {
    hostname: 'relay01',
    ip: '10.2.0.30',
    ports: { 22: 'SSH-2.0-OpenSSH_9.6', 80: 'relayd/1.8' },
    accounts: {
      dewitt: { uid: PEOPLE.dewitt, gid: PEOPLE.dewitt },
      root: { uid: 0, gid: 0 },
    },
  },
] as const;

export { MATTERS };
