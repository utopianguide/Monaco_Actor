import type { FiredActionMeta, TimelineAction } from './types';

export interface TimelineSchedulerCallbacks {
  onAction: (action: TimelineAction, meta: FiredActionMeta) => void;
  onComplete?: () => void;
  onSeek?: (timeMs: number) => void;
  onReset?: () => void;
}

export interface TimelineSchedulerOptions {
  audio: HTMLAudioElement;
  actions?: TimelineAction[];
  callbacks: TimelineSchedulerCallbacks;
  /** Maximum tolerated drift before firing an action early/late. Defaults to a single frame (~16ms). */
  toleranceMs?: number;
}

/**
 * Pull-based scheduler that uses the associated audio element as the source of truth for time.
 * It keeps a pointer to the next un-fired action and executes it when audio.currentTime reaches the scheduled mark.
 */
export class TimelineScheduler {
  private audio: HTMLAudioElement;
  private callbacks: TimelineSchedulerCallbacks;
  private actions: TimelineAction[] = [];
  private pointer = 0;
  private toleranceMs: number;
  private frameHandle: number | null = null;
  private running = false;
  private completeEmitted = false;
  private boundTick = () => this.tick();
  private boundHandleSeek = () => this.handleSeek();
  private boundHandleEnded = () => this.handleEnded();

  constructor(options: TimelineSchedulerOptions) {
    this.audio = options.audio;
    this.callbacks = options.callbacks;
    this.toleranceMs = options.toleranceMs ?? 16;

    if (options.actions) {
      this.setActions(options.actions);
    }

    this.audio.addEventListener('seeked', this.boundHandleSeek);
    this.audio.addEventListener('ended', this.boundHandleEnded);
  }

  getActions() {
    return this.actions;
  }

  getPointer() {
    return this.pointer;
  }

  setActions(actions: TimelineAction[]): void {
    this.actions = [...actions].sort((a, b) => a.timeMs - b.timeMs);
    this.resetPointer();
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.completeEmitted = false;
    this.scheduleNextFrame();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  reset(): void {
    this.stop();
    this.resetPointer();
    this.callbacks.onReset?.();
  }

  seekTo(timeMs: number): void {
    if (Number.isFinite(timeMs)) {
      this.audio.currentTime = timeMs / 1000;
      this.syncPointer(timeMs);
      this.callbacks.onSeek?.(timeMs);
    }
  }

  prime(timeMs: number): void {
    this.syncPointer(timeMs);
  }

  /**
   * Prime the scheduler so that all actions scheduled at or before the given time
   * are considered already fired. This is useful when you've just rebuilt state
   * up to an exact cue and want the next frame to start AFTER that cue.
   */
  primeAfter(timeMs: number): void {
    this.syncPointerAfter(timeMs);
  }

  dispose(): void {
    this.stop();
    this.audio.removeEventListener('seeked', this.boundHandleSeek);
    this.audio.removeEventListener('ended', this.boundHandleEnded);
    this.actions = [];
  }

  private tick(): void {
    if (!this.running) {
      return;
    }

    const nowMs = this.audio.currentTime * 1000;
    while (this.pointer < this.actions.length) {
      const next = this.actions[this.pointer];
      if (next.timeMs - this.toleranceMs <= nowMs) {
        const meta: FiredActionMeta = {
          scheduledTimeMs: next.timeMs,
          actualTimeMs: nowMs,
          driftMs: nowMs - next.timeMs,
        };
        this.callbacks.onAction(next, meta);
        this.pointer += 1;
      } else {
        break;
      }
    }

    if (this.pointer >= this.actions.length) {
      if (!this.completeEmitted) {
        this.completeEmitted = true;
        this.callbacks.onComplete?.();
      }
      this.stop();
      return;
    }

    this.scheduleNextFrame();
  }

  private scheduleNextFrame() {
    this.frameHandle = requestAnimationFrame(this.boundTick);
  }

  private handleSeek() {
    const timeMs = this.audio.currentTime * 1000;
    this.syncPointer(timeMs);
    this.callbacks.onSeek?.(timeMs);
  }

  private handleEnded() {
    this.pointer = this.actions.length;
    if (!this.completeEmitted) {
      this.completeEmitted = true;
      this.callbacks.onComplete?.();
    }
    this.stop();
  }

  private resetPointer() {
    this.pointer = 0;
    this.completeEmitted = false;
    const timeMs = this.audio.currentTime * 1000;
    if (timeMs > 0) {
      this.syncPointer(timeMs);
    }
  }

  private syncPointer(timeMs: number) {
    if (timeMs <= 0) {
      this.pointer = 0;
      this.completeEmitted = false;
      return;
    }

    let idx = 0;
    while (idx < this.actions.length && this.actions[idx].timeMs < timeMs - this.toleranceMs) {
      idx += 1;
    }
    this.pointer = idx;
    this.completeEmitted = this.pointer >= this.actions.length;
  }

  /**
   * Inclusive variant used when the caller has already applied effects up to timeMs.
   * Skips actions whose scheduled time is <= timeMs (with tolerance) so they do not re-fire.
   */
  private syncPointerAfter(timeMs: number) {
    if (timeMs <= 0) {
      this.pointer = 0;
      this.completeEmitted = false;
      return;
    }

    let idx = 0;
    while (idx < this.actions.length && this.actions[idx].timeMs <= timeMs + this.toleranceMs) {
      idx += 1;
    }
    this.pointer = idx;
    this.completeEmitted = this.pointer >= this.actions.length;
  }
}
