import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { ProcessTable } from '../src/proc/table.js';
import { SIGKILL, SIGTERM, type Process, type SignalOutcome } from '../src/proc/types.js';

/**
 * Signals.
 *
 * The lesson The Wreck's fifth puzzle is built on, and the reason the series
 * is called what it is: a signal is a message, a program may decline to act
 * on it, and exactly one of them is not up for discussion.
 */
describe('signals', () => {
  it('ends a process that traps nothing', () => {
    const table = new ProcessTable(() => 0);
    const p = table.spawn(['/usr/sbin/quiet']);

    expect(table.signal(p.pid, SIGTERM)).toBe('killed');
    expect(table.get(p.pid)).toBeUndefined();
  });

  it('leaves a process that traps the signal exactly where it was', () => {
    const table = new ProcessTable(() => 0);
    const p = table.spawn(['/usr/sbin/stubborn'], { traps: [SIGTERM] });

    expect(table.signal(p.pid, SIGTERM)).toBe('trapped');
    expect(table.get(p.pid)?.argv).toEqual(['/usr/sbin/stubborn']);
  });

  it('honours no trap on SIGKILL, however it is listed', () => {
    const table = new ProcessTable(() => 0);
    // A process is welcome to claim it traps 9. It does not get to.
    const p = table.spawn(['/usr/sbin/stubborn'], { traps: [SIGTERM, SIGKILL] });

    expect(table.signal(p.pid, SIGKILL)).toBe('killed');
    expect(table.get(p.pid)).toBeUndefined();
  });

  it('reports a pid that is not there', () => {
    const table = new ProcessTable(() => 0);
    expect(table.signal(4242, SIGTERM)).toBe('no-such-process');
  });

  it('tells a watcher what happened, and stops when unwatched', () => {
    const table = new ProcessTable(() => 0);
    const seen: Array<[string, number, SignalOutcome]> = [];
    const unwatch = table.watch((p: Process, signal, outcome) =>
      seen.push([p.argv[0] ?? '', signal, outcome]),
    );

    const p = table.spawn(['/usr/sbin/purge'], { traps: [SIGTERM] });
    table.signal(p.pid, SIGTERM);
    table.signal(p.pid, SIGKILL);
    unwatch();
    const q = table.spawn(['/usr/sbin/other']);
    table.signal(q.pid, SIGTERM);

    expect(seen).toEqual([
      ['/usr/sbin/purge', SIGTERM, 'trapped'],
      ['/usr/sbin/purge', SIGKILL, 'killed'],
    ]);
  });

  it('carries traps through a snapshot', () => {
    const table = new ProcessTable(() => 0);
    const p = table.spawn(['/usr/sbin/purge'], { traps: [SIGTERM] });

    const restored = new ProcessTable(() => 0);
    restored.restore(JSON.parse(JSON.stringify(table.snapshot())));

    expect(restored.signal(p.pid, SIGTERM)).toBe('trapped');
    expect(restored.signal(p.pid, SIGKILL)).toBe('killed');
  });
});

describe('kill', () => {
  const boot = (): Machine => new Machine({ hostname: 'nav7' });

  it('says nothing when the process catches the signal, and exits 0', async () => {
    const m = boot();
    const p = m.procs.spawn(['/usr/sbin/purge', '--continuous'], { uid: 1000, traps: [SIGTERM] });

    const result = await m.exec(`kill ${p.pid}`);

    // Real kill reports delivery, not obedience. The way to find out is ps.
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect((await m.exec('ps')).stdout).toContain('/usr/sbin/purge');
  });

  it('ends it with -9', async () => {
    const m = boot();
    const p = m.procs.spawn(['/usr/sbin/purge', '--continuous'], { uid: 1000, traps: [SIGTERM] });

    await m.exec(`kill -9 ${p.pid}`);
    expect((await m.exec('ps')).stdout).not.toContain('/usr/sbin/purge');
  });

  it('takes the signal by name as well as by number', async () => {
    const m = boot();
    const p = m.procs.spawn(['/usr/sbin/purge'], { uid: 1000, traps: [SIGTERM] });

    await m.exec(`kill -KILL ${p.pid}`);
    expect(m.procs.get(p.pid)).toBeUndefined();
  });

  it('refuses a signal it does not know rather than quietly sending TERM', async () => {
    const m = boot();
    const p = m.procs.spawn(['/usr/sbin/purge'], { uid: 1000 });

    const result = await m.exec(`kill -BANANA ${p.pid}`);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('invalid signal');
    expect(m.procs.get(p.pid)).toBeDefined();
  });

  it('lists the signals it knows', async () => {
    const result = await (boot()).exec('kill -l');
    expect(result.stdout).toContain('SIGKILL');
    expect(result.stdout).toContain('SIGTERM');
    expect(result.code).toBe(0);
  });

  it('will not let one user signal another user process', async () => {
    const m = boot();
    const p = m.procs.spawn(['/usr/sbin/rootly'], { uid: 0 });

    const result = await m.exec(`kill ${p.pid}`);
    expect(result.stderr).toContain('Operation not permitted');
    expect(m.procs.get(p.pid)).toBeDefined();
  });
});
