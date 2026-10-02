import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

/**
 * The second half of game six's spike: services, as an operator meets them.
 *
 * The network probe (`probe-net.test.ts`) covered reaching another machine.
 * This covers the other verb of an operations game -- making something run,
 * watching it refuse, and reading back why.
 *
 * The finding here is a gap rather than a bug, and it is the one that decides
 * how much engine game six needs: **a unit file has no dependencies.**
 * `units.ts` parses `Description` and `ExecStart` and nothing else, so
 * `Requires=`, `After=` and `Wants=` are silently ignored. The curriculum text
 * for this stage is "operate and change systems *with dependencies*, observe
 * failures, deploy and roll back", and three of those four work today.
 *
 * What does exist, and is better than a dependency field for some purposes, is
 * `setPrecondition` -- an adventure-supplied check that runs at start time and
 * whose refusal reaches both `systemctl status` and the journal. It is the
 * right tool for "the scrubber cannot start because the duct is blocked". It
 * is the wrong tool for "the API cannot start before the database", because
 * the player cannot read it: it is a closure in TypeScript, not a line in a
 * file they can `cat`.
 */

function host(): Machine {
  const m = new Machine({ hostname: 'api01' });
  m.vfs.mkdirp('/etc/systemd/system', ROOT_USER);
  m.vfs.mkdirp('/home/dewitt', ROOT_USER);
  m.vfs.chown('/home/dewitt', 1000, 1000, ROOT_USER);
  m.vfs.writeText('/etc/sudoers', 'dewitt ALL=(ALL) NOPASSWD: ALL\n', ROOT_USER);
  m.shell.cwd = '/home/dewitt';
  return m;
}

const unit = (m: Machine, name: string, body: string): void => {
  m.vfs.writeText(`/etc/systemd/system/${name}.service`, body, ROOT_USER);
};

describe('probe: a unit is a file, and editing it changes behaviour', () => {
  it('re-reads the file rather than caching what it saw at boot', async () => {
    const m = host();
    unit(m, 'api', '[Unit]\nDescription=The API\n\n[Service]\nExecStart=/usr/bin/api\n');
    expect((await m.exec('systemctl status api')).stdout).toContain('The API');

    // A deploy is often exactly this: change the file, restart, check. It
    // needs sudo, because a unit file belongs to root -- and the exit status
    // is asserted, because the first draft of this probe did not and a silent
    // "Permission denied" looked exactly like a caching bug in the engine.
    const edit = await m.exec(
      "sudo sed -i 's/Description=.*/Description=The API, v2/' /etc/systemd/system/api.service",
    );
    expect(edit.stderr).toBe('');
    expect(edit.code).toBe(0);
    expect((await m.exec('systemctl status api')).stdout).toContain('The API, v2');
  });

  it('shows enablement as a symlink, which ls can see', async () => {
    const m = host();
    unit(m, 'api', '[Unit]\nDescription=The API\n\n[Service]\nExecStart=/usr/bin/api\n');
    await m.exec('sudo systemctl enable api');

    const ls = await m.exec('ls /etc/systemd/system/multi-user.target.wants');
    expect(ls.stdout).toContain('api.service');
    expect(m.services.isEnabled('api')).toBe(true);
  });
});

describe('probe: a start that is refused, and reading back why', () => {
  it('puts the reason in status and in the journal, saying the same thing', async () => {
    const m = host();
    unit(m, 'api', '[Unit]\nDescription=The API\n\n[Service]\nExecStart=/usr/bin/api\n');
    m.services.setPrecondition('api', () => ({
      ok: false,
      reason: 'database unreachable: db01:5432',
    }));

    const start = await m.exec('sudo systemctl start api');
    expect(start.code).not.toBe(0);

    const status = await m.exec('systemctl status api');
    expect(status.stdout).toContain('database unreachable');

    const journal = await m.exec('journalctl -u api');
    expect(journal.stdout).toContain('database unreachable');
  });

  it('starts once the reason goes away, with no other change', async () => {
    const m = host();
    unit(m, 'api', '[Unit]\nDescription=The API\n\n[Service]\nExecStart=/usr/bin/api\n');
    let dbUp = false;
    m.services.setPrecondition('api', () =>
      dbUp ? { ok: true } : { ok: false, reason: 'database unreachable' },
    );

    expect((await m.exec('sudo systemctl start api')).code).not.toBe(0);
    dbUp = true;
    expect((await m.exec('sudo systemctl start api')).code).toBe(0);
    expect(m.services.get('api')?.state).toBe('active');
  });
});

describe('probe: rolling back', () => {
  it('a bad config, a failed start, and the previous file put back', async () => {
    const m = host();
    m.vfs.mkdirp('/etc/app', ROOT_USER);
    m.vfs.writeText('/etc/app/config', 'workers=4\n', ROOT_USER);
    unit(m, 'api', '[Unit]\nDescription=The API\n\n[Service]\nExecStart=/usr/bin/api\n');

    // The service refuses whatever config it is handed unless workers is sane.
    m.services.setPrecondition('api', () => {
      const text = m.vfs.readText('/etc/app/config', ROOT_USER);
      const workers = Number(/workers=(\d+)/.exec(text)?.[1] ?? '0');
      return workers > 0 ? { ok: true } : { ok: false, reason: 'workers must be at least 1' };
    });

    expect((await m.exec('sudo systemctl start api')).code).toBe(0);

    // Keep a copy, break it, watch it fail: the shape of every bad deploy.
    // Every step's status is checked, so a refused write cannot masquerade as
    // a service that started when it should not have.
    expect((await m.exec('sudo cp /etc/app/config /etc/app/config.bak')).code).toBe(0);
    const brk = await m.exec("sudo sed -i 's/workers=4/workers=0/' /etc/app/config");
    expect(brk.code).toBe(0);
    expect(m.vfs.readText('/etc/app/config', ROOT_USER)).toContain('workers=0');

    expect((await m.exec('sudo systemctl stop api')).code).toBe(0);
    expect((await m.exec('sudo systemctl start api')).code).not.toBe(0);

    // Roll back, and it comes up on the old config.
    expect((await m.exec('sudo cp /etc/app/config.bak /etc/app/config')).code).toBe(0);
    expect((await m.exec('sudo systemctl start api')).code).toBe(0);
    expect(m.services.get('api')?.state).toBe('active');
  });
});

describe('probe: the journal as evidence', () => {
  it('keeps the sequence, so what happened can be read back in order', async () => {
    const m = host();
    unit(m, 'api', '[Unit]\nDescription=The API\n\n[Service]\nExecStart=/usr/bin/api\n');
    let healthy = true;
    m.services.setPrecondition('api', () =>
      healthy ? { ok: true } : { ok: false, reason: 'config rejected' },
    );

    await m.exec('sudo systemctl start api');
    await m.exec('sudo systemctl stop api');
    healthy = false;
    await m.exec('sudo systemctl start api');

    const journal = await m.exec('journalctl -u api');
    expect(journal.stdout).toContain('config rejected');
    // Everything about this unit and nothing about any other.
    expect(journal.code).toBe(0);
  });
});

/**
 * The gap, now closed.
 *
 * `Requires=` and `After=` are the two lines an operator reads first when a
 * service will not come up, and the parser knew neither. They were accepted
 * into the file without complaint and then ignored, which is worse than being
 * rejected: a player who writes `Requires=db.service` because they have seen
 * one before got no error and no effect and no way to tell which.
 *
 * Both are parsed now, and they do different things, because they *are*
 * different things and the difference is one of the genuinely confusing parts
 * of systemd:
 *
 *   Requires=  a hard dependency. Starting while it is inactive is refused,
 *              and the refusal names the unit that was missing.
 *   After=     ordering, and nothing else. It decides who goes first at boot
 *              and has no opinion about whether the other unit is running.
 *
 * Modelling `After=` as though it implied `Requires=` would have been the
 * easier lie and would have taught the confusion instead of curing it.
 */
describe('Requires= is a dependency', () => {
  it('refuses to start while the required unit is inactive, and says which', async () => {
    const m = host();
    unit(m, 'db', '[Unit]\nDescription=Database\n\n[Service]\nExecStart=/usr/bin/db\n');
    unit(
      m,
      'api',
      '[Unit]\nDescription=The API\nRequires=db.service\n\n[Service]\nExecStart=/usr/bin/api\n',
    );

    const refused = await m.exec('sudo systemctl start api');
    expect(refused.code).not.toBe(0);
    expect(m.services.get('api')?.state).not.toBe('active');

    // The name of the missing unit is the whole value of the message.
    const status = await m.exec('systemctl status api');
    expect(status.stdout).toContain('db.service is not active');

    // And it is in the journal, so it survives being scrolled past.
    expect((await m.exec('journalctl -u api')).stdout).toContain('db.service is not active');
  });

  it('starts once the requirement is met', async () => {
    const m = host();
    unit(m, 'db', '[Unit]\nDescription=Database\n\n[Service]\nExecStart=/usr/bin/db\n');
    unit(
      m,
      'api',
      '[Unit]\nDescription=The API\nRequires=db.service\n\n[Service]\nExecStart=/usr/bin/api\n',
    );

    expect((await m.exec('sudo systemctl start db')).code).toBe(0);
    expect((await m.exec('sudo systemctl start api')).code).toBe(0);
    expect(m.services.get('api')?.state).toBe('active');
  });

  it('takes the name with or without the .service suffix', async () => {
    const m = host();
    unit(m, 'db', '[Unit]\nDescription=Database\n\n[Service]\nExecStart=/usr/bin/db\n');
    unit(m, 'api', '[Unit]\nDescription=The API\nRequires=db\n\n[Service]\nExecStart=/usr/bin/api\n');

    expect((await m.exec('sudo systemctl start api')).code).not.toBe(0);
    await m.exec('sudo systemctl start db');
    expect((await m.exec('sudo systemctl start api')).code).toBe(0);
  });
});

describe('After= is ordering and nothing else', () => {
  it('does not stop a unit starting by hand while the other is down', async () => {
    const m = host();
    unit(m, 'db', '[Unit]\nDescription=Database\n\n[Service]\nExecStart=/usr/bin/db\n');
    unit(
      m,
      'api',
      '[Unit]\nDescription=The API\nAfter=db.service\n\n[Service]\nExecStart=/usr/bin/api\n',
    );

    // This is the thing people expect to fail and which does not. Asserting it
    // keeps the simulation honest about a real and widely misunderstood rule.
    expect((await m.exec('sudo systemctl start api')).code).toBe(0);
    expect(m.services.get('api')?.state).toBe('active');
    expect(m.services.get('db')?.state).not.toBe('active');
  });

  it('decides who goes first at boot, which is what it is for', async () => {
    const m = host();
    unit(m, 'db', '[Unit]\nDescription=Database\n\n[Service]\nExecStart=/usr/bin/db\n');
    unit(
      m,
      'api',
      '[Unit]\nDescription=The API\nRequires=db.service\nAfter=db.service\n\n' +
        '[Service]\nExecStart=/usr/bin/api\n',
    );
    await m.exec('sudo systemctl enable db');
    await m.exec('sudo systemctl enable api');

    // Alphabetically api comes first, so without ordering its Requires= would
    // refuse and the boot would come up with the API dead. That is the bug
    // After= exists to prevent, and it is why the two directives are usually
    // written together.
    m.services.startEnabled();

    expect(m.services.get('db')?.state).toBe('active');
    expect(m.services.get('api')?.state).toBe('active');
  });

  it('survives a cycle rather than hanging on one', async () => {
    const m = host();
    unit(m, 'a', '[Unit]\nDescription=A\nAfter=b.service\n\n[Service]\nExecStart=/usr/bin/a\n');
    unit(m, 'b', '[Unit]\nDescription=B\nAfter=a.service\n\n[Service]\nExecStart=/usr/bin/b\n');
    await m.exec('sudo systemctl enable a');
    await m.exec('sudo systemctl enable b');

    m.services.startEnabled();
    expect(m.services.get('a')?.state).toBe('active');
    expect(m.services.get('b')?.state).toBe('active');
  });
});
