export type TimelineActionKind =
  | 'create_file'
  | 'open_file'
  | 'type'
  | 'move_cursor'
  | 'highlight_range'
  | 'terminal_run'
  | 'terminal_output'
  | 'clear_terminal';

export interface TimelineActionBase<K extends TimelineActionKind = TimelineActionKind> {
  /** Optional unique identifier useful for debugging */
  id?: string;
  /** Discriminator for the action */
  kind: K;
  /** Time to trigger the action relative to the audio start */
  timeMs: number;
  /** Free-form metadata carried through to handlers */
  metadata?: Record<string, unknown>;
}

export interface CreateFileAction extends TimelineActionBase<'create_file'> {
  path: string;
  content?: string;
}

export interface OpenFileAction extends TimelineActionBase<'open_file'> {
  path: string;
}

export interface TypeAction extends TimelineActionBase<'type'> {
  path: string;
  text: string;
  /** Optional delay to keep typing active after the scheduled start */
  delayMs?: number;
}

export interface MoveCursorAction extends TimelineActionBase<'move_cursor'> {
  path: string;
  line: number;
  column: number;
}

export interface HighlightRangeAction extends TimelineActionBase<'highlight_range'> {
  path: string;
  range: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  durationMs?: number;
}

export interface TerminalRunAction extends TimelineActionBase<'terminal_run'> {
  command: string;
}

export interface TerminalOutputAction extends TimelineActionBase<'terminal_output'> {
  text: string;
  delayMs?: number;
}

export interface ClearTerminalAction extends TimelineActionBase<'clear_terminal'> {}

export type TimelineAction =
  | CreateFileAction
  | OpenFileAction
  | TypeAction
  | MoveCursorAction
  | HighlightRangeAction
  | TerminalRunAction
  | TerminalOutputAction
  | ClearTerminalAction;

export type TimelineActionMap = {
  [K in TimelineAction['kind']]: Extract<TimelineAction, { kind: K }>;
};

export interface FiredActionMeta {
  scheduledTimeMs: number;
  actualTimeMs: number;
  driftMs: number;
}
