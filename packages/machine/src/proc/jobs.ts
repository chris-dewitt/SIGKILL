export type JobState = 'running' | 'done';

export interface Job {
  /** Shell job number, the `[1]` in `[1]+ Running`. Counts from 1 per session. */
  id: number;
  pid: number;
  command: string;
  state: JobState;
  exitCode: number | undefined;
  /**
   * Virtual-clock time at which this job finishes.
   *
   * Commands here execute instantly, so for most jobs this equals the time
   * they started. A backgrounded `sleep` is the interesting case: it does not
   * advance the clock, it books a completion in the future, which is what
   * makes `wait` and `jobs` mean something.
   */
  completesAt: number;
  /** Output held until the job is reaped, the way a real shell defers it. */
  stdout: string;
  stderr: string;
}

/**
 * Background jobs.
 *
 * A note on honesty: nothing here runs concurrently, because nothing in the
 * Machine runs concurrently. A backgrounded command executes immediately and
 * deterministically; what "background" actually buys is that its *output* is
 * deferred and its *completion time* can sit in the future. That is enough to
 * teach `&`, `jobs` and `wait` truthfully, and it keeps every run reproducible.
 */
export class JobTable {
  private jobs: Job[] = [];
  private nextId = 1;

  add(job: Omit<Job, 'id'>): Job {
    const created: Job = { ...job, id: this.nextId++ };
    this.jobs.push(created);
    return created;
  }

  /** Mark everything whose completion time has passed as done. */
  settle(now: number): Job[] {
    const finished: Job[] = [];
    for (const job of this.jobs) {
      if (job.state === 'running' && job.completesAt <= now) {
        job.state = 'done';
        finished.push(job);
      }
    }
    return finished;
  }

  list(): Job[] {
    return [...this.jobs];
  }

  running(): Job[] {
    return this.jobs.filter((j) => j.state === 'running');
  }

  get(id: number): Job | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  /** Drop reported-done jobs, as a shell does once it has printed them. */
  reap(): Job[] {
    const done = this.jobs.filter((j) => j.state === 'done');
    this.jobs = this.jobs.filter((j) => j.state !== 'done');
    return done;
  }

  /** The latest completion time among running jobs, for `wait`. */
  latestCompletion(): number | undefined {
    const times = this.running().map((j) => j.completesAt);
    return times.length > 0 ? Math.max(...times) : undefined;
  }

  snapshot(): { nextId: number; jobs: Job[] } {
    return { nextId: this.nextId, jobs: this.jobs.map((j) => ({ ...j })) };
  }

  restore(snap: { nextId: number; jobs: Job[] }): void {
    this.nextId = snap.nextId;
    this.jobs = snap.jobs.map((j) => ({ ...j }));
  }
}
