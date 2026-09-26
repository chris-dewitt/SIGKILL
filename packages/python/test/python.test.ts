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
  v.mkdirp('/home/dewitt', ROOT_USER);
  v.chown('/home/dewitt', 1000, 1000, ROOT_USER);
  v.mkdirp('/etc', ROOT_USER);
  v.mkdirp('/var/log', ROOT_USER);
  v.chmod('/var/log', 0o777, ROOT_USER);
  v.writeText('/etc/life_support.conf', 'O2_TARGET=16\nSCRUBBER_DUTY=0.4\n', ROOT_USER);
  v.chmod('/etc/life_support.conf', 0o666, ROOT_USER);
  v.writeText('/var/log/boot.log', 'ok\nFAIL scrubber\nok\nFAIL comms\n', ROOT_USER);
  m.shell.cwd = '/home/dewitt';
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
    m.vfs.writeText('/home/dewitt/args.py', 'import sys\nprint(sys.argv[1:])\n', ROOT_USER);
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
    expect((await m.exec('cd deep/nested/path && pwd')).stdout).toBe('/home/dewitt/deep/nested/path\n');
  });

  it('deletes a file, and the shell agrees it is gone', async () => {
    const m = boot();
    await m.exec('echo doomed > doomed.txt');
    await m.exec(`python3 -c 'import os; os.remove("doomed.txt")'`);
    expect(m.vfs.exists('/home/dewitt/doomed.txt', ROOT_USER)).toBe(false);
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
    expect(m.vfs.stat('/home/dewitt/empty/made/deeper', ROOT_USER).kind).toBe('dir');
  });

  it('survives binary content round-tripping through the bridge', async () => {
    const m = boot();
    const bytes = new Uint8Array([0, 1, 127, 128, 200, 255]);
    m.vfs.write('/home/dewitt/blob.bin', bytes, ROOT_USER);

    const r = await m.exec(`python3 -c 'print(list(open("blob.bin","rb").read()))'`);
    expect(r.stdout.trim()).toBe('[0, 1, 127, 128, 200, 255]');

    await m.exec(`python3 -c 'open("copy.bin","wb").write(open("blob.bin","rb").read())'`);
    expect([...m.vfs.read('/home/dewitt/copy.bin', ROOT_USER)]).toEqual([...bytes]);
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

/*
 * Two leaks that only a debugging adventure would have caught.
 *
 * Both were found by writing a broken script and reading what the player
 * would have read: the traceback pointed at `<exec>`, a file nobody can open,
 * under three frames of Pyodide's own plumbing; and `time.time()` answered
 * with the host's wall clock, which no replay can reproduce.
 *
 * In a game whose whole subject is reading an error message, the error
 * message is not cosmetic. It is the level.
 */
describe('the traceback belongs to the player', () => {
  it('names the script being run, not the interpreter that ran it', async () => {
    const m = boot();
    m.vfs.writeText('/home/dewitt/bad.py', 'rows = [1, 2]\nprint(rows[9])\n', ROOT_USER);

    const r = await m.exec('python3 bad.py');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('File "bad.py", line 2');
    expect(r.stderr).toContain('IndexError');
  });

  it('shows no interpreter frames at all -- every line is openable', async () => {
    const m = boot();
    m.vfs.writeText('/home/dewitt/bad.py', 'raise ValueError("scrubber offline")\n', ROOT_USER);

    const r = await m.exec('python3 bad.py');
    // `<exec>` is the shim; `_pyodide` and the stdlib zip are the runtime.
    // A player cannot open any of them, so none of them may appear.
    expect(r.stderr).not.toContain('<exec>');
    expect(r.stderr).not.toContain('_pyodide');
    expect(r.stderr).not.toMatch(/python\d*\.zip/);
    expect(r.stderr).toContain('ValueError: scrubber offline');
  });

  it('walks a real call chain across files, deepest frame last', async () => {
    const m = boot();
    m.vfs.writeText('/home/dewitt/scrub.py', 'def duty(rows):\n    return sum(rows) / len(rows)\n', ROOT_USER);
    m.vfs.writeText('/home/dewitt/run.py', 'import scrub\nprint(scrub.duty([]))\n', ROOT_USER);

    const r = await m.exec('python3 run.py');
    const frames = [...r.stderr.matchAll(/File "([^"]+)", line (\d+)/g)].map((f) => `${f[1]}:${f[2]}`);
    expect(frames).toEqual(['run.py:2', '/home/dewitt/scrub.py:2']);
    expect(r.stderr).toContain('ZeroDivisionError');
  });

  it('calls -c code `<string>` and a pipe `<stdin>`, the way python does', async () => {
    const m = boot();
    expect((await m.exec(`python3 -c 'raise SystemError("x")'`)).stderr).toContain('File "<string>", line 1');
    expect((await m.exec(`echo 'raise SystemError("x")' | python3`)).stderr).toContain('File "<stdin>", line 1');
  });
});

describe('time.time() is the machine clock', () => {
  /*
   * Deliberately the virtual clock and not the ship's calendar.
   *
   * Python cannot hold 2398 at all -- `PyTime_t` is int64 nanoseconds, so
   * anything past roughly 2262 raises `OverflowError: timestamp too large`.
   * Handing the interpreter the adventure's epoch would trade a determinism
   * bug for a crash, so the clock aboard measures the session.
   */
  const seconds = async (m: Machine): Promise<number> => {
    const r = await m.exec(`python3 -c 'import time; print(time.time())'`);
    expect(r.stderr).toBe('');
    return Number(r.stdout.trim());
  };

  it('starts at zero and moves only when the machine ticks', async () => {
    const m = boot();
    expect(await seconds(m)).toBe(0);
    m.tick(90_000);
    expect(await seconds(m)).toBe(90);
    m.tick(500);
    expect(await seconds(m)).toBe(90.5);
  });

  it('never reads the host wall clock, whatever the epoch is', async () => {
    const m = new Machine({ hostname: 'nav7', python: runtime, epoch: Date.UTC(2398, 5, 12) });
    m.shell.cwd = '/';
    expect(await seconds(m)).toBe(0);
  });

  it('answers the same twice, which is the whole reason for it', async () => {
    const a = boot();
    const b = boot();
    a.tick(4_000);
    b.tick(4_000);
    const script = `python3 -c 'import time; print("stamped", time.time())'`;
    expect((await a.exec(script)).stdout).toBe((await b.exec(script)).stdout);
  });

  it('gives the host its own clock back, even when the script raises', async () => {
    const m = boot();
    const before = Date.now();
    expect((await m.exec(`python3 -c 'raise RuntimeError("boom")'`)).code).not.toBe(0);
    // A patched `Date.now` escaping into the host would make every later
    // test in this process quietly agree about what time it is.
    expect(Date.now()).toBeGreaterThanOrEqual(before);
    expect(Date.now()).toBeLessThan(before + 60_000);
  });
});

/*
 * Running a script is not the same as a script being `__main__`.
 *
 * This was found by trying to write the sort of test file game three asks the
 * player to write. `unittest.main()` reported NO TESTS RAN against a file with
 * two perfectly good tests in it, because the bridge `exec`'d the code into a
 * bare dict: `__name__` said `__main__`, but `sys.modules['__main__']` was
 * still the interpreter's own module, and that is the one unittest collects
 * from. An adventure about testing cannot ship a runner that tells the player
 * their tests do not exist.
 */
describe('a script really is __main__', () => {
  const SUITE =
    'import unittest\nfrom volume import gigabytes\n\n' +
    'class TestVolume(unittest.TestCase):\n' +
    '    def test_decimal(self):\n' +
    '        self.assertEqual(gigabytes(2_200_000_000), 2.2)\n' +
    '    def test_binary(self):\n' +
    '        self.assertEqual(gigabytes(1024 ** 3), 1.0)\n';

  const MAIN = "\nif __name__ == '__main__':\n    unittest.main()\n";

  function withVolume(): Machine {
    const m = boot();
    m.vfs.writeText('/home/dewitt/volume.py', 'def gigabytes(b):\n    return b / 1000 ** 3\n', ROOT_USER);
    return m;
  }

  it('registers itself, so unittest.main() finds the tests in it', async () => {
    const m = withVolume();
    m.vfs.writeText('/home/dewitt/test_volume.py', SUITE + MAIN, ROOT_USER);

    const r = await m.exec('python3 test_volume.py');
    expect(r.stderr).toContain('Ran 2 tests');
    expect(r.stderr).not.toContain('NO TESTS RAN');
  });

  it('reports the failing assertion, on the line the player wrote it on', async () => {
    const m = withVolume();
    m.vfs.writeText('/home/dewitt/test_volume.py', SUITE + MAIN, ROOT_USER);

    const r = await m.exec('python3 test_volume.py');
    // 1024**3 bytes is 1.073741824 GB, not 1.0. The test is wrong and the code
    // is right, and telling those two apart is the subject of the adventure.
    expect(r.stderr).toContain('AssertionError: 1.073741824 != 1.0');
    expect(r.stderr).toContain('File "test_volume.py", line 8');
    expect(r.stderr).toContain('FAILED (failures=1)');
    expect(r.code).toBe(1);
  });

  it('exits clean and quiet when every test passes', async () => {
    const m = withVolume();
    m.vfs.writeText(
      '/home/dewitt/test_volume.py',
      'import unittest\nfrom volume import gigabytes\n\n' +
        'class TestVolume(unittest.TestCase):\n' +
        '    def test_decimal(self):\n' +
        '        self.assertEqual(gigabytes(2_200_000_000), 2.2)\n' +
        MAIN,
      ROOT_USER,
    );

    const r = await m.exec('python3 test_volume.py');
    expect(r.stderr).toContain('OK');
    expect(r.stderr).not.toContain('Traceback');
    expect(r.code).toBe(0);
  });

  it('leaves the guard alone when the file is imported instead of run', async () => {
    const m = boot();
    m.vfs.writeText(
      '/home/dewitt/tool.py',
      "def work():\n    return 'worked'\n\nif __name__ == '__main__':\n    print('ran as main')\n",
      ROOT_USER,
    );
    m.vfs.writeText('/home/dewitt/use.py', 'import tool\nprint(tool.work())\n', ROOT_USER);

    expect((await m.exec('python3 tool.py')).stdout).toBe('ran as main\n');
    expect((await m.exec('python3 use.py')).stdout).toBe('worked\n');
  });
});

describe('sys.exit is a status, not a stack trace', () => {
  it('prints nothing at all for an integer', async () => {
    const m = boot();
    const r = await m.exec(`python3 -c 'import sys; print("done"); sys.exit(3)'`);
    expect(r.code).toBe(3);
    expect(r.stdout).toBe('done\n');
    expect(r.stderr).toBe('');
  });

  it('treats a bare exit as success', async () => {
    const m = boot();
    const r = await m.exec(`python3 -c 'import sys; sys.exit()'`);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('prints a string argument as the message, and fails', async () => {
    const m = boot();
    const r = await m.exec(`python3 -c 'import sys; sys.exit("no scrubber data")'`);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe('no scrubber data\n');
    expect(r.stderr).not.toContain('Traceback');
  });

  it('still shows a traceback for an exception that is not an exit', async () => {
    const m = boot();
    const r = await m.exec(`python3 -c 'raise SystemError("different thing")'`);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Traceback');
    expect(r.stderr).toContain('SystemError: different thing');
  });
});

describe('python3 -m, because that is how the stdlib is run', () => {
  /** A module and a suite for it, with no main guard anywhere. */
  function withSuite(): Machine {
    const m = boot();
    m.vfs.writeText('/home/dewitt/volume.py', 'def gigabytes(b):\n    return b / 1000 ** 3\n', ROOT_USER);
    m.vfs.writeText(
      '/home/dewitt/test_volume.py',
      'import unittest\nfrom volume import gigabytes\n\n' +
        'class TestVolume(unittest.TestCase):\n' +
        '    def test_decimal(self):\n' +
        '        self.assertEqual(gigabytes(2_200_000_000), 2.2)\n',
      ROOT_USER,
    );
    return m;
  }

  it('discovers and runs a suite that has no main guard', async () => {
    const r = await withSuite().exec('python3 -m unittest');
    expect(r.stderr).toContain('Ran 1 test');
    expect(r.stderr).toContain('OK');
    expect(r.code).toBe(0);
  });

  it('hands its own flags to the module and not to the interpreter', async () => {
    // `-v` belongs to unittest. If the interpreter eats it, the player types
    // the documented command and watches it quietly do nothing.
    const r = await withSuite().exec('python3 -m unittest -v');
    expect(r.stderr).toContain('test_decimal (test_volume.TestVolume.test_decimal) ... ok');
  });

  it('reaches any stdlib module, not a list somebody approved', async () => {
    const m = boot();
    m.vfs.writeText('/home/dewitt/one.json', '{"o2":21,"crew":1}', ROOT_USER);
    const r = await m.exec('python3 -m json.tool one.json');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"o2": 21');
  });

  it('shows only the player frame when the module raises', async () => {
    const m = boot();
    m.vfs.writeText('/home/dewitt/broken.py', 'raise ValueError("bad row")\n', ROOT_USER);

    const r = await m.exec('python3 -m broken');
    expect(r.stderr).toContain('ValueError: bad row');
    expect(r.stderr).toContain('/home/dewitt/broken.py');
    // CPython prints three `<frozen runpy>` frames above this one. They say
    // how the program was started, which the player knows -- they typed it.
    expect(r.stderr).not.toContain('runpy');
  });

  it('passes a program its arguments, with -c and with a file', async () => {
    const m = boot();
    const inline = await m.exec(`python3 -c 'import sys; print(sys.argv[1:])' rows.csv --strict`);
    expect(inline.stdout).toBe("['rows.csv', '--strict']\n");

    m.vfs.writeText('/home/dewitt/args.py', 'import sys\nprint(sys.argv[1:])\n', ROOT_USER);
    expect((await m.exec('python3 args.py rows.csv --strict')).stdout).toBe("['rows.csv', '--strict']\n");
  });
});

describe('one command cannot break the next one', () => {
  /*
   * The interpreter is loaded once and serves the whole session, which means
   * anything a command does to it persists. This was found by accident: a test
   * that passed alone failed in the suite, and the culprit was two tests
   * earlier.
   */
  it('survives json.tool, which closes stdout on its way out', async () => {
    const m = boot();
    m.vfs.writeText('/home/dewitt/one.json', '{"o2":21}', ROOT_USER);

    expect((await m.exec('python3 -m json.tool one.json')).stdout).toContain('"o2": 21');

    // Without the repair this prints nothing, exits 0, and says nothing about
    // why -- and the player blames the script they just wrote.
    const after = await m.exec(`python3 -c 'print("still here")'`);
    expect(after.stdout).toBe('still here\n');
    expect(after.code).toBe(0);
  });

  it('survives a script that closes stdout itself', async () => {
    const m = boot();
    m.vfs.writeText('/home/dewitt/rude.py', 'import sys\nsys.stdout.close()\n', ROOT_USER);

    await m.exec('python3 rude.py');
    expect((await m.exec(`python3 -c 'print("fine")'`)).stdout).toBe('fine\n');
  });

  it('keeps stderr and tracebacks working after the same abuse', async () => {
    const m = boot();
    m.vfs.writeText('/home/dewitt/rude.py', 'import sys\nsys.stderr.close()\n', ROOT_USER);

    await m.exec('python3 rude.py');
    const r = await m.exec(`python3 -c 'raise ValueError("readable")'`);
    expect(r.stderr).toContain('ValueError: readable');
  });
});

describe('edit, re-run, and get the new answer', () => {
  /*
   * The bug this exists for would have made an adventure about debugging
   * impossible to play.
   *
   * Python caches imports in `sys.modules`, and one interpreter serves every
   * command in the session. So a player who imported their module, found the
   * bug, fixed it and ran again got the *old* answer, silently, with no error
   * and nothing to distinguish it from having been wrong about the fix.
   */
  it('picks up an edit to an imported module', async () => {
    const m = boot();
    m.vfs.writeText('/home/dewitt/calc.py', 'def answer():\n    return 1\n', ROOT_USER);
    expect((await m.exec(`python3 -c 'import calc; print(calc.answer())'`)).stdout).toBe('1\n');

    m.vfs.writeText('/home/dewitt/calc.py', 'def answer():\n    return 42\n', ROOT_USER);
    expect((await m.exec(`python3 -c 'import calc; print(calc.answer())'`)).stdout).toBe('42\n');
  });

  it('picks up an edit the shell made, not just one the host made', async () => {
    const m = boot();
    // Written through the shell, so it is his file and `sed -i` may edit it.
    expect((await m.exec(`echo 'VALUE = "before"' > /home/dewitt/calc.py`)).stderr).toBe('');
    expect((await m.exec(`python3 -c 'import calc; print(calc.VALUE)'`)).stdout).toBe('before\n');

    expect((await m.exec(`sed -i 's/before/after/' /home/dewitt/calc.py`)).stderr).toBe('');
    expect((await m.exec(`python3 -c 'import calc; print(calc.VALUE)'`)).stdout).toBe('after\n');
  });

  it('notices a module the shell deleted', async () => {
    const m = boot();
    m.vfs.writeText('/home/dewitt/gone.py', 'X = 1\n', ROOT_USER);
    expect((await m.exec(`python3 -c 'import gone; print(gone.X)'`)).stdout).toBe('1\n');

    await m.exec('rm /home/dewitt/gone.py');
    const after = await m.exec(`python3 -c 'import gone'`);
    expect(after.code).not.toBe(0);
    expect(after.stderr).toContain('ModuleNotFoundError');
  });

  it('runs the same suite from two directories without an import clash', async () => {
    const m = boot();
    m.vfs.writeText('/home/dewitt/calc.py', 'def total(xs):\n    return sum(xs)\n', ROOT_USER);
    m.vfs.writeText(
      '/home/dewitt/test_calc.py',
      'import unittest\nimport calc\n\n' +
        'class TestCalc(unittest.TestCase):\n' +
        '    def test_sums(self):\n        self.assertEqual(calc.total([1, 2]), 3)\n' +
        '    def test_empty(self):\n        self.assertEqual(calc.total([]), 0)\n',
      ROOT_USER,
    );
    expect((await m.exec('python3 -m unittest 2> /home/dewitt/one.txt')).stderr).toBe('');

    // The same file names, one directory down -- which is exactly what
    // assembling a submission looks like. Without the purge this is an
    // ImportError about the module being "incorrectly imported".
    await m.exec('mkdir -p /home/dewitt/hearing');
    await m.exec('cp /home/dewitt/calc.py /home/dewitt/test_calc.py /home/dewitt/hearing/');
    await m.exec('cd /home/dewitt/hearing');
    expect((await m.exec('python3 -m unittest 2> /home/dewitt/hearing/two.txt')).stderr).toBe('');
    expect(m.vfs.readText('/home/dewitt/hearing/two.txt', ROOT_USER)).toContain('OK');
  });

  it('leaves no bytecode cache behind, because a .pyc holds a timestamp', async () => {
    const m = boot();
    m.vfs.writeText('/home/dewitt/calc.py', 'X = 1\n', ROOT_USER);
    await m.exec(`python3 -c 'import calc'`);

    const listing = (await m.exec('ls -a /home/dewitt')).stdout;
    expect(listing).not.toContain('__pycache__');
    expect(listing).not.toContain('.pyc');
  });
});
