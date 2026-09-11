/**
 * POSIX-shaped error codes.
 *
 * These exist so coreutils can format failures the way the real tools do.
 * A player who has seen `ENOENT` in real life should see the same words here,
 * and a player who has not should be able to search what they see and find
 * the real thing.
 */
export type Errno =
  | 'ENOENT'    // no such file or directory
  | 'EEXIST'    // file exists
  | 'EISDIR'    // is a directory
  | 'ENOTDIR'   // not a directory
  | 'ENOTEMPTY' // directory not empty
  | 'EACCES'    // permission denied
  | 'ELOOP'     // too many levels of symbolic links
  | 'EINVAL'    // invalid argument
  | 'EPERM'     // operation not permitted
  | 'ENOSPC';   // no space left on device

const MESSAGES: Record<Errno, string> = {
  ENOENT: 'No such file or directory',
  EEXIST: 'File exists',
  EISDIR: 'Is a directory',
  ENOTDIR: 'Not a directory',
  ENOTEMPTY: 'Directory not empty',
  EACCES: 'Permission denied',
  ELOOP: 'Too many levels of symbolic links',
  EINVAL: 'Invalid argument',
  EPERM: 'Operation not permitted',
  ENOSPC: 'No space left on device',
};

export class FsError extends Error {
  readonly code: Errno;
  readonly path: string | undefined;

  constructor(code: Errno, path?: string) {
    super(`${code}: ${MESSAGES[code]}${path ? `, '${path}'` : ''}`);
    this.name = 'FsError';
    this.code = code;
    this.path = path;
  }

  /** The bare message a coreutil appends after `tool: path: `. */
  get reason(): string {
    return MESSAGES[this.code];
  }
}

export function isFsError(e: unknown): e is FsError {
  return e instanceof FsError;
}
