import { describe, expect, it } from 'vitest';
import {
  clearSave,
  readLastPlayed,
  readSave,
  savedAdventures,
  saveKey,
  writeLastPlayed,
  writeSave,
  type WreckSave,
} from '../src/save.js';

function memory(): Storage {
  const bag = new Map<string, string>();
  return {
    get length() {
      return bag.size;
    },
    clear() {
      bag.clear();
    },
    getItem(key: string) {
      return bag.get(key) ?? null;
    },
    key(index: number) {
      return [...bag.keys()][index] ?? null;
    },
    removeItem(key: string) {
      bag.delete(key);
    },
    setItem(key: string, value: string) {
      bag.set(key, value);
    },
  };
}

const stub = {
  version: 1,
  machine: { version: 1 },
  quest: { version: 1, revealed: {}, asked: 0 },
  actEnded: false,
  history: ['ls'],
} as unknown as WreckSave;

describe('one slot per adventure', () => {
  it('round-trips a save through storage', () => {
    const store = memory();
    writeSave('wreck', stub, store);
    expect(store.getItem(saveKey('wreck'))?.length).toBeGreaterThan(10);
    const read = readSave('wreck', store);
    expect(read?.history).toEqual(['ls']);
    expect(read?.actEnded).toBe(false);
  });

  it('returns null for missing or junk data', () => {
    const store = memory();
    expect(readSave('wreck', store)).toBeNull();
    store.setItem(saveKey('wreck'), '{');
    expect(readSave('wreck', store)).toBeNull();
    store.setItem(saveKey('wreck'), JSON.stringify({ version: 2 }));
    expect(readSave('wreck', store)).toBeNull();
  });

  it('clears one slot and leaves the others alone', () => {
    const store = memory();
    writeSave('wreck', stub, store);
    writeSave('harness', stub, store);

    clearSave('wreck', store);
    expect(readSave('wreck', store)).toBeNull();
    // `newgame` in one adventure must not touch a run in another. This is the
    // whole reason the key stopped being a constant.
    expect(readSave('harness', store)?.history).toEqual(['ls']);
  });

  it('keeps three runs at once without them meeting', () => {
    const store = memory();
    for (const [i, id] of ['wreck', 'archive', 'harness'].entries()) {
      writeSave(id, { ...stub, history: [`command-${i}`] }, store);
    }
    expect(readSave('wreck', store)?.history).toEqual(['command-0']);
    expect(readSave('archive', store)?.history).toEqual(['command-1']);
    expect(readSave('harness', store)?.history).toEqual(['command-2']);
  });

  it('reports which adventures have a run in progress', () => {
    const store = memory();
    writeSave('archive', stub, store);
    expect(savedAdventures(['wreck', 'archive', 'harness'], store)).toEqual(new Set(['archive']));
  });
});

describe('the returning player', () => {
  it('remembers which adventure was open', () => {
    const store = memory();
    expect(readLastPlayed(store)).toBeNull();
    writeLastPlayed('harness', store);
    expect(readLastPlayed(store)).toBe('harness');
  });

  /*
   * Somebody is mid-act in a browser right now under the old single key. A
   * rename is not a reason to take that away from them, so the legacy key is
   * read once and answers for The Wreck -- and only for The Wreck, because it
   * is the only game that could have written it.
   */
  it('finds a run saved before there was more than one game', () => {
    const store = memory();
    store.setItem('sigkill:wreck:save', JSON.stringify(stub));

    expect(readSave('wreck', store)?.history).toEqual(['ls']);
    expect(readLastPlayed(store)).toBe('wreck');
    expect(readSave('archive', store)).toBeNull();
  });

  it('forgets the legacy key too when the run is wiped', () => {
    const store = memory();
    store.setItem('sigkill:wreck:save', JSON.stringify(stub));
    clearSave('wreck', store);
    expect(readSave('wreck', store)).toBeNull();
  });

  it('prefers its own slot over the legacy one once it has written one', () => {
    const store = memory();
    store.setItem('sigkill:wreck:save', JSON.stringify({ ...stub, history: ['old'] }));
    writeSave('wreck', { ...stub, history: ['new'] }, store);
    expect(readSave('wreck', store)?.history).toEqual(['new']);
  });
});
