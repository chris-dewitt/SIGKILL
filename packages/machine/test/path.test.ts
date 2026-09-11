import { describe, expect, it } from 'vitest';
import * as p from '../src/vfs/path.js';

describe('path', () => {
  it('normalises . and ..', async () => {
    expect(p.normalize('/a/b/../c')).toBe('/a/c');
    expect(p.normalize('/a/./b/')).toBe('/a/b');
    expect(p.normalize('/..')).toBe('/');
    expect(p.normalize('a/../..')).toBe('..');
    expect(p.normalize('')).toBe('.');
  });

  it('resolves relative against cwd', async () => {
    expect(p.resolve('/home/survivor', 'logs')).toBe('/home/survivor/logs');
    expect(p.resolve('/home/survivor', '/etc')).toBe('/etc');
    expect(p.resolve('/home/survivor', '../root')).toBe('/home/root');
  });

  it('splits dirname and basename like POSIX', async () => {
    expect(p.dirname('/a/b/c')).toBe('/a/b');
    expect(p.dirname('/a')).toBe('/');
    expect(p.dirname('/')).toBe('/');
    expect(p.basename('/a/b/c')).toBe('c');
    expect(p.basename('/')).toBe('/');
  });
});
