import { beforeAll, describe, expect, it } from 'vitest';
import { Machine, ROOT_USER } from '@sigkill/machine';
import { NodePythonRuntime } from '../src/node.js';

// One interpreter for the whole file: booting Pyodide costs seconds, running
// against it costs milliseconds.
const runtime = new NodePythonRuntime();

beforeAll(async () => {
  await runtime.ready();
}, 180_000);

function boot(): Machine {
  const m = new Machine({ hostname: 'nav7', python: runtime });
  const v = m.vfs;
  v.mkdirp('/home/survivor', ROOT_USER);
  v.chown('/home/survivor', 1000, 1000, ROOT_USER);
  v.mkdirp('/etc', ROOT_USER);
  v.mkdirp('/var/log', ROOT_USER);
  v.chmod('/var/log', 0o777, ROOT_USER);
  v.writeText('/etc/life_support.conf', 'O2_TARGET=16\nSCRUBBER_DUTY=0.4\n', ROOT_USER);
  v.chmod('/etc/life_support.conf', 0o666, ROOT_USER);
  v.writeText('/var/log/boot.log', 'ok\nFAIL scrubber\nok\nFAIL comms\n', ROOT_USER);
  m.shell.cwd = '/home/survivor';
  return m;
}

describe('the interpreter', () => {
  it('is real Python, not a lookalike', async () => {
    const m = boot();
    // A pattern-matcher would have to have anticipated this exact expression.
    const r = await m.exec(`python3 -c 'print(sum(i*i for i in range(10)))'`);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('285\n');
  });

  it('has a standard library', async () => {
    const m = boot();
    const r = await m.exec(
      `python3 -c 'import json,collections; print(json.dumps(collections.Counter("abracadabra").most_common(2)))'`,
    );
    expect(r.stdout.trim()).toBe('[["a", 5], ["b", 2]]');
  });

  it('reports the version', async () => {
    const m = boot();
    expect((await m.exec('python3 -V')).stdout).toMatch(/^Python \d+\.\d+/);
  });

  it('passes a real traceback through, because the traceback is the lesson', async () => {
    const m = boot();
    const r = await m.exec(`python3 -c 'x = [1,2,3]; print(x[9])'`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('IndexError');
    expect(r.stderr).toContain('list index out of range');
  });

  it('honours sys.exit', async () => {
    const m = boot();
    expect((await m.exec(`python3 -c 'import sys; sys.exit(3)'`)).code).toBe(3);
  });

  it('reads argv', async () => {
    const m = boot();
    m.vfs.writeText('/home/survivor/args.py', 'import sys\nprint(sys.argv[1:])\n', ROOT_USER);
    expect((await m.exec('python3 args.py alpha beta')).stdout.trim()).toBe("['alpha', 'beta']");
  });

  it('reads stdin from a pipe', async () => {
    const m = boot();
    const r = await m.exec(`cat /var/log/boot.log | python3 -c 'import sys; print(sum(1 for l in sys.stdin if "FAIL" in l))'`);
    expect(r.stdout).toBe('2\n');
  });
});

describe('one filesystem, two languages', () => {
  it('reads a file the shell created', async () => {
    const m = boot();
    await m.exec('echo from-the-shell > note.txt');
    const r = await m.exec(`python3 -c 'print(open("note.txt").read().strip())'`);
    expect(r.stdout).toBe('from-the-shell\n');
  });

  it('writes a file the shell then reads', async () => {
    const m = boot();
    await m.exec(`python3 -c 'open("from-python.txt","w").write("hello from python\\n")'`);
    expect((await m.exec('cat from-python.txt')).stdout).toBe('hello from python\n');
  });

  // The moment the whole engine exists for.
  it('edits config with Python, and grep sees it', async () => {
    const m = boot();
    expect((await m.exec('grep O2 /etc/life_support.conf')).stdout).toBe('O2_TARGET=16\n');

    const edit = await m.exec(
      `python3 -c 'import pathlib; p = pathlib.Path("/etc/life_support.conf"); p.write_text(p.read_text().replace("16","21"))'`,
    );
    expect(edit.stderr).toBe('');

    expect((await m.exec('grep O2 /etc/life_support.conf')).stdout).toBe('O2_TARGET=21\n');
    expect((await m.exec('cat /etc/life_support.conf | wc -l')).stdout.trim()).toBe('2');
  });

  it('sees a directory tree with os.listdir', async () => {
    const m = boot();
    await m.exec('mkdir -p work/logs && touch work/a.txt work/b.txt');
    const r = await m.exec(`python3 -c 'import os; print(sorted(os.listdir("work")))'`);
    expect(r.stdout.trim()).toBe("['a.txt', 'b.txt', 'logs']");
  });

  it('creates directories the shell can cd into', async () => {
    const m = boot();
    await m.exec(`python3 -c 'import os; os.makedirs("deep/nested/path")'`);
    expect((await m.exec('cd deep/nested/path && pwd')).stdout).toBe('/home/survivor/deep/nested/path\n');
  });

  it('deletes a file, and the shell agrees it is gone', async () => {
    const m = boot();
    await m.exec('echo doomed > doomed.txt');
    await m.exec(`python3 -c 'import os; os.remove("doomed.txt")'`);
    expect(m.vfs.exists('/home/survivor/doomed.txt', ROOT_USER)).toBe(false);
    expect((await m.exec('cat doomed.txt')).code).toBe(1);
  });

  it('does not see a file the shell deleted before it ran', async () => {
    const m = boot();
    await m.exec('echo temporary > gone.txt');
    await m.exec(`python3 -c 'print(open("gone.txt").read().strip())'`);
    await m.exec('rm gone.txt');

    // A stale interpreter filesystem would still have it. Each run starts
    // from the machine's current disk.
    const r = await m.exec(`python3 -c 'import os; print(os.path.exists("gone.txt"))'`);
    expect(r.stdout).toBe('False\n');
  });

  it('starts in the shell working directory', async () => {
    const m = boot();
    await m.exec('cd /var/log');
    expect((await m.exec(`python3 -c 'import os; print(os.getcwd())'`)).stdout).toBe('/var/log\n');
  });

  it('sees the shell environment', async () => {
    const m = boot();
    await m.exec('export SECTOR=deck-c');
    const r = await m.exec(`python3 -c 'import os; print(os.environ["SECTOR"])'`);
    expect(r.stdout).toBe('deck-c\n');
  });

  it('runs a script the player wrote with a here-doc-ish redirect', async () => {
    const m = boot();
    await m.exec('echo "import pathlib" > fix.py');
    await m.exec('echo "p = pathlib.Path(\'/etc/life_support.conf\')" >> fix.py');
    await m.exec('echo "p.write_text(p.read_text().replace(\'16\',\'21\'))" >> fix.py');

    const r = await m.exec('python3 fix.py');
    expect(r.stderr).toBe('');
    expect((await m.exec('grep O2 /etc/life_support.conf')).stdout).toBe('O2_TARGET=21\n');
  });

  it('composes into a pipeline like any other command', async () => {
    const m = boot();
    // 0 3 6 9 12, and grep -v 0 drops only the literal "0".
    const r = await m.exec(
      `python3 -c 'for i in range(5): print(i*3)' | grep -v 0 | wc -l`,
    );
    expect(r.stdout.trim()).toBe('4');
  });

  it('carries an empty directory in both directions', async () => {
    const m = boot();
    await m.exec('mkdir -p empty/inner');
    const seen = await m.exec(`python3 -c 'import os; print(os.listdir("empty"))'`);
    expect(seen.stdout.trim()).toBe("['inner']");

    await m.exec(`python3 -c 'import os; os.makedirs("empty/made/deeper")'`);
    expect(m.vfs.stat('/home/survivor/empty/made/deeper', ROOT_USER).kind).toBe('dir');
  });

  it('survives binary content round-tripping through the bridge', async () => {
    const m = boot();
    const bytes = new Uint8Array([0, 1, 127, 128, 200, 255]);
    m.vfs.write('/home/survivor/blob.bin', bytes, ROOT_USER);

    const r = await m.exec(`python3 -c 'print(list(open("blob.bin","rb").read()))'`);
    expect(r.stdout.trim()).toBe('[0, 1, 127, 128, 200, 255]');

    await m.exec(`python3 -c 'open("copy.bin","wb").write(open("blob.bin","rb").read())'`);
    expect([...m.vfs.read('/home/survivor/copy.bin', ROOT_USER)]).toEqual([...bytes]);
  });
});

describe('a machine with no interpreter', () => {
  it('says python is not installed rather than pretending', async () => {
    const m = new Machine({ hostname: 'bare' });
    const r = await m.exec(`python3 -c 'print(1)'`);
    expect(r.code).toBe(127);
    expect(r.stderr).toContain('no Python interpreter is installed');
  });
});

describe('goals stay solution-agnostic across languages', () => {
  const goal = (m: Machine): boolean =>
    m.vfs.readText('/etc/life_support.conf', ROOT_USER).includes('O2_TARGET=21');

  const routes: Array<[string, string[]]> = [
    ['sed', ["sed -i 's/O2_TARGET=16/O2_TARGET=21/' /etc/life_support.conf"]],
    ['python one-liner', [
      `python3 -c 'import pathlib; p=pathlib.Path("/etc/life_support.conf"); p.write_text(p.read_text().replace("16","21"))'`,
    ]],
    ['python rewriting from scratch', [
      `python3 -c 'open("/etc/life_support.conf","w").write("O2_TARGET=21\\nSCRUBBER_DUTY=0.4\\n")'`,
    ]],
    ['shell redirect', [
      'echo O2_TARGET=21 > /etc/life_support.conf',
      'echo SCRUBBER_DUTY=0.4 >> /etc/life_support.conf',
    ]],
  ];

  for (const [name, commands] of routes) {
    it(`accepts: ${name}`, async () => {
      const m = boot();
      expect(goal(m)).toBe(false);
      for (const command of commands) {
        const r = await m.exec(command);
        expect(r.stderr, `${command} -> ${r.stderr}`).toBe('');
      }
      expect(goal(m)).toBe(true);
    });
  }
});

describe('the interpreter filesystem never goes stale', () => {
  it('forgets a directory the shell removed', async () => {
    const m = boot();
    await m.exec('mkdir -p transient/inner');
    expect((await m.exec(`python3 -c 'import os; print(os.path.isdir("transient"))'`)).stdout)
      .toBe('True\n');

    await m.exec('rm -r transient');
    const r = await m.exec(`python3 -c 'import os; print(os.path.isdir("transient"))'`);
    expect(r.stdout).toBe('False\n');
  });

  it('reflects an edit the shell made between two runs', async () => {
    const m = boot();
    await m.exec('echo one > shared.txt');
    expect((await m.exec(`python3 -c 'print(open("shared.txt").read().strip())'`)).stdout)
      .toBe('one\n');

    await m.exec("sed -i 's/one/two/' shared.txt");
    expect((await m.exec(`python3 -c 'print(open("shared.txt").read().strip())'`)).stdout)
      .toBe('two\n');
  });
});
