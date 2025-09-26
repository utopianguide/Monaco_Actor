import type * as monaco from 'monaco-editor';
import type { TimelineAction, HighlightRangeAction, MoveCursorAction, TypeAction } from '../timeline';
import { VirtualFileSystem } from './virtualFileSystem';
import type { TerminalController } from '../terminal/terminalController';

interface ActionExecutorOptions {
  onFileOpened?: (path: string | null) => void;
  onFileCreated?: (path: string) => void;
}

export class ActionExecutor {
  private fs = new VirtualFileSystem();
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private monacoInstance: typeof monaco | null = null;
  private terminal: TerminalController | null = null;
  private highlightDecorations: string[] = [];
  private highlightTimeout: number | null = null;
  private options: ActionExecutorOptions;
  private isBatch = false;
  private isPlaying = false;
  private typingInterval: number | null = null;
  private typingState: {
    path: string;
    text: string;
    offsetChars: number;
    msPerChar: number;
    model: monaco.editor.ITextModel;
  } | null = null;

  constructor(options: ActionExecutorOptions = {}) {
    this.options = options;
  }

  attachEditor(editor: monaco.editor.IStandaloneCodeEditor, monacoInstance: typeof monaco) {
    this.editor = editor;
    this.monacoInstance = monacoInstance;
    this.fs.attach(monacoInstance);
  }

  attachTerminal(terminal: TerminalController | null) {
    this.terminal = terminal;
  }

  reset() {
    this.fs.reset();
    if (this.editor) {
      this.editor.setModel(null);
    }
    if (this.highlightTimeout) {
      window.clearTimeout(this.highlightTimeout);
      this.highlightTimeout = null;
    }
    if (this.highlightDecorations.length > 0 && this.editor) {
      this.editor.deltaDecorations(this.highlightDecorations, []);
    }
    this.highlightDecorations = [];
    this.terminal?.clear();
    this.cancelTyping();
    this.options.onFileOpened?.(null);
  }

  dispose() {
    this.reset();
    this.fs.dispose();
    this.editor = null;
    this.monacoInstance = null;
    this.terminal = null;
  }

  execute(action: TimelineAction) {
    switch (action.kind) {
      case 'create_file': {
        this.fs.createFile(action.path, action.content ?? '');
        const model = this.fs.openFile(action.path);
        this.openModel(model, action.path);
        this.options.onFileCreated?.(action.path);
        break;
      }
      case 'open_file': {
        const model = this.fs.openFile(action.path);
        this.openModel(model, action.path);
        break;
      }
      case 'type': {
        this.applyTypeAction(action);
        break;
      }
      case 'move_cursor': {
        this.applyMoveCursor(action);
        break;
      }
      case 'highlight_range': {
        this.applyHighlight(action);
        break;
      }
      case 'terminal_run': {
        this.terminal?.runCommand(action.command);
        break;
      }
      case 'terminal_output': {
        this.terminal?.write(action.text);
        break;
      }
      case 'clear_terminal': {
        this.terminal?.clear();
        break;
      }
      default: {
        const neverAction: never = action;
        console.warn('Unhandled action', neverAction);
      }
    }
  }

  focusFile(path: string) {
    const model = this.ensureFileOpen(path);
    if (!model || !this.editor || !this.monacoInstance) {
      return;
    }
    const end = model.getFullModelRange().getEndPosition();
    this.editor.setPosition(end);
    this.editor.revealPositionInCenter(end, this.monacoInstance.editor.ScrollType.Smooth);
  }

  private openModel(model: monaco.editor.ITextModel, path: string) {
    if (!this.editor) {
      return;
    }
    this.editor.setModel(model);
    this.fs.markOpened(path);
    this.options.onFileOpened?.(path);
  }

  private ensureFileOpen(path: string) {
    const currentModel = this.editor?.getModel();
    if (currentModel && this.fs.getOpenedPath() === path) {
      return currentModel;
    }
    const model = this.fs.openFile(path);
    if (this.editor) {
      this.editor.setModel(model);
    }
    this.fs.markOpened(path);
    this.options.onFileOpened?.(path);
    return model;
  }

  private applyTypeAction(action: TypeAction) {
    const model = this.ensureFileOpen(action.path);
    if (!model || !this.editor || !this.monacoInstance) {
      return;
    }
    // In batch mode (seek/rebuild), apply immediately for speed and determinism
    if (this.isBatch) {
      model.pushEditOperations(
        [],
        [
          {
            range: this.fullInsertRange(model),
            text: action.text,
            forceMoveMarkers: true,
          },
        ],
        () => null,
      );
      const endPos = model.getFullModelRange().getEndPosition();
      this.editor.setPosition(endPos);
      this.editor.revealPositionInCenter(endPos, this.monacoInstance.editor.ScrollType.Smooth);
      return;
    }

    // If charactersPerSecond or delayMs specified, animate typing
    const cps = (action as any).charactersPerSecond
      ? Math.max(1, Math.floor((action as any).charactersPerSecond as number))
      : action.delayMs && action.delayMs > 0
        ? Math.max(1, Math.floor(action.text.length / (action.delayMs / 1000)))
        : 0;

    if (cps > 0) {
      this.startTyping(model, action.path, action.text, 1000 / cps);
      return;
    }

    // Default: immediate paste
    model.pushEditOperations(
      [],
      [
        {
          range: this.fullInsertRange(model),
          text: action.text,
          forceMoveMarkers: true,
        },
      ],
      () => null,
    );
    const end = model.getFullModelRange().getEndPosition();
    this.editor.setPosition(end);
    this.editor.revealPositionInCenter(end, this.monacoInstance.editor.ScrollType.Smooth);
  }

  private fullInsertRange(model: monaco.editor.ITextModel) {
    const editor = this.editor!;
    const monaco = this.monacoInstance!;
    const currentPosition = editor.getPosition() ?? model.getFullModelRange().getEndPosition();
    return new monaco.Range(
      currentPosition.lineNumber,
      currentPosition.column,
      currentPosition.lineNumber,
      currentPosition.column,
    );
  }

  private startTyping(model: monaco.editor.ITextModel, path: string, text: string, msPerChar: number) {
    // Cancel any ongoing typing
    this.cancelTyping();
    // Initialize state
    this.typingState = {
      path,
      text,
      offsetChars: 0,
      msPerChar,
      model,
    };

    const tick = () => {
      if (!this.typingState || !this.editor || !this.monacoInstance) {
        return;
      }
      if (!this.isPlaying) {
        return; // paused; keep state, do not advance
      }
      const state = this.typingState;
      if (state.offsetChars >= state.text.length) {
        this.cancelTyping();
        return;
      }

      // Determine how many chars we can emit this tick
      const chunkSize = Math.max(1, Math.floor(16 / state.msPerChar));
      const nextEnd = Math.min(state.text.length, state.offsetChars + chunkSize);
      const chunk = state.text.slice(state.offsetChars, nextEnd);

      const range = this.fullInsertRange(state.model);
      state.model.pushEditOperations(
        [],
        [
          {
            range,
            text: chunk,
            forceMoveMarkers: true,
          },
        ],
        () => null,
      );

      state.offsetChars = nextEnd;
      const end = state.model.getFullModelRange().getEndPosition();
      this.editor.setPosition(end);
      this.editor.revealPositionInCenter(end, this.monacoInstance.editor.ScrollType.Smooth);
    };

    // Run at ~60fps
    this.typingInterval = window.setInterval(tick, 16);
  }

  private cancelTyping() {
    if (this.typingInterval) {
      window.clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
    this.typingState = null;
  }

  beginBatch() {
    this.isBatch = true;
    this.cancelTyping();
  }

  endBatch() {
    this.isBatch = false;
  }

  setPlaying(playing: boolean) {
    this.isPlaying = playing;
  }

  /**
   * Immediately applies any remaining characters from the active typing animation
   * and clears the typing state. Used when the audio completes to avoid
   * leaving half-typed content on screen.
   */
  flushTypingNow() {
    if (!this.typingState || !this.editor || !this.monacoInstance) {
      return;
    }
    const state = this.typingState;
    if (state.offsetChars < state.text.length) {
      const remaining = state.text.slice(state.offsetChars);
      const range = this.fullInsertRange(state.model);
      state.model.pushEditOperations(
        [],
        [
          {
            range,
            text: remaining,
            forceMoveMarkers: true,
          },
        ],
        () => null,
      );
    }
    const end = state.model.getFullModelRange().getEndPosition();
    this.editor.setPosition(end);
    this.editor.revealPositionInCenter(end, this.monacoInstance.editor.ScrollType.Smooth);
    this.cancelTyping();
  }

  private applyMoveCursor(action: MoveCursorAction) {
    const model = this.ensureFileOpen(action.path);
    if (!model || !this.editor || !this.monacoInstance) {
      return;
    }
    const position = new this.monacoInstance.Position(action.line, action.column);
    this.editor.setPosition(position);
    this.editor.revealPositionInCenter(position, this.monacoInstance.editor.ScrollType.Smooth);
  }

  private applyHighlight(action: HighlightRangeAction) {
    const model = this.ensureFileOpen(action.path);
    if (!model || !this.editor || !this.monacoInstance) {
      return;
    }
    const range = new this.monacoInstance.Range(
      action.range.startLine,
      action.range.startColumn,
      action.range.endLine,
      action.range.endColumn,
    );
    const className = action.color ? `timeline-inline-highlight color-${action.color}` : 'timeline-inline-highlight';
    this.highlightDecorations = this.editor.deltaDecorations(this.highlightDecorations, [
      {
        range,
        options: {
          inlineClassName: className,
        },
      },
    ]);

    if (this.highlightTimeout) {
      window.clearTimeout(this.highlightTimeout);
    }
    if (action.durationMs) {
      this.highlightTimeout = window.setTimeout(() => {
        if (this.editor) {
          this.highlightDecorations = this.editor.deltaDecorations(this.highlightDecorations, []);
        }
      }, action.durationMs);
    }
  }
}
