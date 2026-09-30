/**
 * A word-level tokenizer over an authored vocabulary.
 *
 * Word-level rather than byte-pair, because the lesson this adventure teaches
 * is what a token *is*, and BPE answers that question with "a thing you get
 * from a training corpus". A fixed table a player can `cat` answers it with a
 * list they can read, and the surprise that matters -- that the model sees
 * numbers and never saw your sentence -- survives either way.
 *
 * Unknown words become `<unk>`, visibly. A tokenizer that silently dropped
 * them would teach that models handle anything, which is the opposite of true.
 */

export const UNK = '<unk>';
export const PAD = '<pad>';

export class Tokenizer {
  readonly words: readonly string[];
  private readonly ids = new Map<string, number>();

  constructor(words: readonly string[]) {
    // PAD and UNK are always 0 and 1, so a vocabulary file can be edited
    // without the two ids every other part of the system relies on moving.
    const full = [PAD, UNK, ...words.filter((w) => w !== PAD && w !== UNK)];
    this.words = full;
    for (const [id, word] of full.entries()) this.ids.set(word, id);
  }

  get size(): number {
    return this.words.length;
  }

  /** Lowercased and split on anything that is not a word character. */
  encode(text: string): number[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((word) => word.length > 0)
      .map((word) => this.ids.get(word) ?? this.ids.get(UNK)!);
  }

  decode(tokens: readonly number[]): string {
    return tokens.map((id) => this.words[id] ?? UNK).join(' ');
  }

  id(word: string): number | undefined {
    return this.ids.get(word.toLowerCase());
  }

  word(id: number): string | undefined {
    return this.words[id];
  }
}
