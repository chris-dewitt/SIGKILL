import { ROOT_USER, type CommandSpec, type Machine, type ShellContext } from '@sigkill/machine';

/**
 * `deposit` -- the store's own retrieval tool, and the thing that writes the
 * record down.
 *
 * Deposited material is mode 0600 and owned by root, so nobody reads it by
 * opening it. They ask the store, the store reads it on their behalf, and the
 * store appends a line saying who asked and for what. That is not security
 * theatre: it is the only reason the access log is worth anything, because a
 * record written by the operator proves nothing about the operator.
 *
 * The honest limitation, written down rather than hidden: DeWitt has sudo, so
 * `sudo cat` reads a matter without leaving a line. The engine cannot see
 * that and this command does not pretend to. It is also exactly the act's
 * subject -- going around the record is the one thing an operator must not do,
 * and the game makes the ordinary path the recorded one rather than trying to
 * build a cage around somebody who has the keys.
 */

const two = (n: number): string => String(n).padStart(2, '0');

/** The adventure's calendar, to the minute, as the log is written. */
function stamp(ctx: ShellContext): string {
  const at = new Date(ctx.epoch + ctx.clock());
  return (
    `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}` +
    `T${two(at.getUTCHours())}:${two(at.getUTCMinutes())}`
  );
}

export const DEPOSIT_ROOT = '/srv/deposit';
export const ACCESS_LOG = '/var/log/access.log';

/*
 * The tribunal's copy of the record, on a machine nobody on this floor can
 * log into.
 *
 * The local log alone was not a record: he has root on vault01, so a player
 * who read their own matter could `grep -v` their line out, copy the rest
 * back, and win `clean-hands` with a log that still showed every tribunal
 * read. Shipping each line off the box as it is written is how real audit logs
 * survive the people who administer the machine they describe.
 */
export const LEDGER_HOST = 'ledger';
export const LEDGER_LOG = '/var/log/ledger/vault01.log';

/** The ledger, if it is on the network and answering. */
function ledgerOf(ctx: ShellContext): Machine | undefined {
  const host = ctx.network?.resolve(LEDGER_HOST);
  return host?.up ? host.machine : undefined;
}

/** What the tribunal holds, or nothing if the ledger is gone. */
export function readLedger(ledger: Machine): string {
  try {
    return ledger.vfs.readText(LEDGER_LOG, ROOT_USER);
  } catch {
    return '';
  }
}

export function storeCommands(): CommandSpec[] {
  return [
    {
      name: 'deposit',
      summary: 'retrieve deposited material, and record that you did',
      manual:
        'Read from the deposit store.\n' +
        '  deposit list              every matter held here\n' +
        '  deposit get <matter>/<f>  print one file\n\n' +
        'Deposited files are readable only by the store. Every retrieval it\n' +
        'serves is appended to /var/log/access.log with the account that asked\n' +
        'for it, and the same line is sent to the tribunal\'s ledger\n' +
        '(http://ledger/vault01), which this office can read and cannot write.\n' +
        'That record is written by the store and not by you, which is the whole\n' +
        'of why anybody should believe it.',
      plain:
        'Gets a file out of the deposit store:\n' +
        '  deposit get 7719/manifest\n' +
        'Every read it serves goes in the access log, under your name, and a\n' +
        'copy goes to the tribunal, where nobody here can change it.',
      run: (ctx, argv, io) => {
        const [sub, target] = argv.slice(1);

        if (sub === 'list') {
          let matters: string[];
          try {
            matters = ctx.vfs.readdir(DEPOSIT_ROOT, ROOT_USER).sort();
          } catch {
            io.err('deposit: no store on this machine\n');
            return 1;
          }
          for (const matter of matters) io.out(`${matter}\n`);
          return 0;
        }

        if (sub !== 'get' || target === undefined) {
          io.err('usage: deposit list | deposit get <matter>/<file>\n');
          return 2;
        }

        // No climbing out of the store with a relative path.
        if (target.includes('..') || target.startsWith('/')) {
          io.err(`deposit: ${target}: not a matter\n`);
          return 1;
        }

        const path = `${DEPOSIT_ROOT}/${target}`;
        let body: string;
        try {
          // Read as the store, which is the point: the caller cannot.
          body = ctx.vfs.readText(path, ROOT_USER);
        } catch {
          io.err(`deposit: ${target}: no such file in the store\n`);
          return 1;
        }

        /*
         * The line goes down, in both places, before the body goes out.
         *
         * If either record cannot be written the read does not happen, because
         * a retrieval the store cannot record is a retrieval the store should
         * not serve. Both are checked before either is written, so a refusal
         * never leaves a line in the ledger for a read that was not served.
         */
        const ledger = ledgerOf(ctx);
        if (!ledger) {
          io.err('deposit: cannot reach the ledger; refusing to serve\n');
          return 1;
        }
        let existing: string;
        try {
          existing = ctx.vfs.readText(ACCESS_LOG, ROOT_USER);
        } catch {
          io.err('deposit: cannot write the access log; refusing to serve\n');
          return 1;
        }
        const line = `${stamp(ctx)} ${ctx.user.name} ${target}\n`;
        ledger.vfs.writeText(LEDGER_LOG, `${readLedger(ledger)}${line}`, ROOT_USER);
        ctx.vfs.writeText(ACCESS_LOG, `${existing}${line}`, ROOT_USER);

        io.out(body);
        return 0;
      },
    },
  ];
}
