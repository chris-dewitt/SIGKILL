/**
 * The archive's database, as SQL.
 *
 * Written as statements rather than shipped as a pre-built file, for three
 * reasons. It is readable in the source, so somebody editing the act can see
 * what the world contains. It is readable *in the game* -- the same text is
 * written to `/srv/archive/schema.sql`, and a player who opens it has found a
 * legitimate route to understanding the whole act. And it is deterministic by
 * construction: no timestamps, no `random()`, no autoincrement surprises.
 *
 * Every row here is doing narrative work. The rule Act I was written to
 * applies to rows as well as files: a row is a lead, a lesson, or a person.
 *
 * The one that matters most is the one that is not here. There is no
 * certification row for DeWitt, because Vasquez never filed it -- and the
 * draft sitting in `filings` with her account on it is the difference
 * between forgotten and never got round to it.
 */

export const SCHEMA_PATH = '/srv/archive/schema.sql';
export const CLAIMS_DB = '/srv/archive/claims.db';

/**
 * The schema and its rows.
 *
 * Kept in one string so `sqlite3 claims.db < schema.sql` really does rebuild
 * the world -- which means a player who breaks the database can repair it,
 * and that is a better answer than a save file they cannot inspect.
 */
export const SCHEMA_SQL = [
  '-- FERRYMAN\'S REST CENTRAL ARCHIVE',
  '-- Salvage, registration and certification records.',
  '-- Generated nightly. Do not edit by hand. (Nobody reads this line.)',
  '',
  'CREATE TABLE vessels (',
  '  id       INTEGER PRIMARY KEY,',
  '  hull     TEXT NOT NULL,',
  '  callsign TEXT NOT NULL,',
  '  operator TEXT NOT NULL,',
  '  status   TEXT NOT NULL',
  ');',
  '',
  'CREATE TABLE crew (',
  '  id        INTEGER PRIMARY KEY,',
  '  vessel_id INTEGER NOT NULL,',
  '  name      TEXT NOT NULL,',
  '  role      TEXT NOT NULL,',
  '  engaged   TEXT NOT NULL,',
  '  status    TEXT NOT NULL',
  ');',
  '',
  '-- One row per certified engineer. The absence of a row is not a',
  '-- statement about a person, though the claims clause reads it as one.',
  'CREATE TABLE certifications (',
  '  id       INTEGER PRIMARY KEY,',
  '  crew_id  INTEGER NOT NULL,',
  '  number   TEXT NOT NULL,',
  '  grade    TEXT NOT NULL,',
  '  filed_on TEXT NOT NULL',
  ');',
  '',
  'CREATE TABLE claims (',
  '  id        INTEGER PRIMARY KEY,',
  '  vessel_id INTEGER NOT NULL,',
  '  clause    TEXT NOT NULL,',
  '  survivors INTEGER NOT NULL,',
  '  status    TEXT NOT NULL,',
  '  filed_on  TEXT NOT NULL',
  ');',
  '',
  '-- Paperwork that was started. The archive keeps drafts for seven years',
  '-- and nobody has ever asked it for one.',
  'CREATE TABLE filings (',
  '  id       INTEGER PRIMARY KEY,',
  '  kind     TEXT NOT NULL,',
  '  subject  TEXT NOT NULL,',
  '  author   TEXT NOT NULL,',
  '  state    TEXT NOT NULL,',
  '  opened   TEXT NOT NULL,',
  '  note     TEXT',
  ');',
  '',
  '-- Bandwidth is billed. This is the table the act ends on.',
  'CREATE TABLE transits (',
  '  id       INTEGER PRIMARY KEY,',
  '  lane     TEXT NOT NULL,',
  '  at       TEXT NOT NULL,',
  '  bytes    INTEGER NOT NULL,',
  '  account  TEXT NOT NULL,',
  '  bound_for TEXT NOT NULL',
  ');',
  '',
  '-- Accounts, so a line item has somebody to belong to.',
  'CREATE TABLE accounts (',
  '  code   TEXT PRIMARY KEY,',
  '  holder TEXT NOT NULL,',
  '  kind   TEXT NOT NULL',
  ');',
  '',
  '-- ---------------------------------------------------------------- rows',
  '',
  "INSERT INTO vessels VALUES (1140, 'KV-1140', 'NAV-7', 'Kepler-Vance Salvage & Recovery', 'bonded');",
  "INSERT INTO vessels VALUES (1141, 'KV-0881', 'HALDANE', 'Kepler-Vance Salvage & Recovery', 'released');",
  "INSERT INTO vessels VALUES (1142, 'FR-0043', 'ELLEN MAY', 'Independent', 'active');",
  '',
  "INSERT INTO crew VALUES (1, 1140, 'vasquez',  'engineering', 'KV-7712', 'deceased');",
  "INSERT INTO crew VALUES (2, 1140, 'chen',     'medical',     'KV-7713', 'deceased');",
  "INSERT INTO crew VALUES (3, 1140, 'okonkwo',  'cargo',       'KV-7714', 'deceased');",
  "INSERT INTO crew VALUES (4, 1140, 'bowen',    'navigation',  'KV-7715', 'missing');",
  "INSERT INTO crew VALUES (5, 1140, 'dewitt',   'apprentice',  'KV-9902', 'unknown');",
  "INSERT INTO crew VALUES (6, 1141, 'aldiss',   'engineering', 'KV-5540', 'active');",
  '',
  "INSERT INTO certifications VALUES (1, 1, 'KV-4471-E', 'chief',    '2397-02-11');",
  "INSERT INTO certifications VALUES (2, 2, 'KV-2210-M', 'medical',  '2396-11-30');",
  "INSERT INTO certifications VALUES (3, 3, 'KV-9938-C', 'cargo',    '2395-08-02');",
  "INSERT INTO certifications VALUES (4, 4, 'KV-1174-N', 'nav',      '2396-04-19');",
  "INSERT INTO certifications VALUES (5, 6, 'KV-3301-E', 'chief',    '2394-01-07');",
  '-- There is no row for crew 5. That is the whole game.',
  '',
  "INSERT INTO claims VALUES (881, 1140, 'salvage.22.b', 0, 'open', '2398-06-10');",
  "INSERT INTO claims VALUES (882, 1141, 'salvage.14.a', 3, 'settled', '2397-03-02');",
  '',
  "INSERT INTO filings VALUES (4402, 'certification', 'dewitt', 'vasquez', 'draft', '2398-05-28',",
  "  'apprenticeship complete, filing at end of rotation -- RV');",
  "INSERT INTO filings VALUES (4403, 'registration', 'LUNA V42', 'vasquez', 'draft', '2398-03-02',",
  "  'unauthorised research instance, will square this away eventually');",
  "INSERT INTO filings VALUES (4404, 'compliance', 'grant addendum 12', 'okonkwo', 'accepted', '2398-04-01',",
  "  'photograph of four socks, accepted without comment');",
  '',
  "INSERT INTO accounts VALUES ('KV-OPS-11',   'Kepler-Vance Salvage & Recovery', 'operations');",
  "INSERT INTO accounts VALUES ('RG-NAV7-03',  'NAV-7 research grant',            'grant');",
  "INSERT INTO accounts VALUES ('FR-YARD-01',  'Ferryman''s Rest bonded yard',    'facility');",
  '',
  '-- Ordinary traffic, and one line that is not.',
  "INSERT INTO transits VALUES (9901, 'KV-OUTER-7', '2398-06-05 18:02', 41200,      'KV-OPS-11',  'lane relay');",
  "INSERT INTO transits VALUES (9902, 'KV-OUTER-9', '2398-06-06 02:15', 8800,       'KV-OPS-11',  'lane relay');",
  "INSERT INTO transits VALUES (9903, 'KV-OUTER-9', '2398-06-06 04:12', 2211404096, 'RG-NAV7-03', 'commercial region 7');",
  "INSERT INTO transits VALUES (9904, 'KV-OUTER-9', '2398-06-08 05:40', 3100,       'KV-OPS-11',  'lane relay');",
  "INSERT INTO transits VALUES (9905, 'KV-OUTER-7', '2398-06-09 11:20', 22800,      'FR-YARD-01', 'lane relay');",
  '',
].join('\n');
