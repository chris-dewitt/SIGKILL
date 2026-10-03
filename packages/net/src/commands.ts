import type { CommandSpec } from '@sigkill/machine';
import { dnsCommands } from './dns.js';
import { interfaceCommands } from './interfaces.js';
import { socketCommands } from './sockets.js';

/**
 * Everything this package adds, as one call.
 *
 * An adventure takes the lot; there is no reason to give a machine `dig` and
 * withhold `host`, and a floor where half the instruments are missing teaches
 * that the tools are arbitrary rather than that the questions are different.
 */
export function netCommands(): CommandSpec[] {
  return [...dnsCommands(), ...socketCommands(), ...interfaceCommands()];
}
