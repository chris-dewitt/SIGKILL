import { describe, expect, it } from 'vitest';
import { clearSave, readSave, writeSave, SAVE_KEY, type WreckSave } from '../src/save.js';

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

describe('wreck save', () => {
  it('round-trips a save through storage', () => {
    const store = memory();
    writeSave(stub, store);
    expect(store.getItem(SAVE_KEY)?.length).toBeGreaterThan(10);
    const read = readSave(store);
    expect(read?.history).toEqual(['ls']);
    expect(read?.actEnded).toBe(false);
  });

  it('returns null for missing or junk data', () => {
    const store = memory();
    expect(readSave(store)).toBeNull();
    store.setItem(SAVE_KEY, '{');
    expect(readSave(store)).toBeNull();
    store.setItem(SAVE_KEY, JSON.stringify({ version: 2 }));
    expect(readSave(store)).toBeNull();
  });

  it('clears the slot', () => {
    const store = memory();
    writeSave(stub, store);
    clearSave(store);
    expect(readSave(store)).toBeNull();
  });
});
