import type * as monaco from 'monaco-editor';
import type { TimelineAction, HighlightRangeAction, MoveCursorAction, TypeAction } from '../timeline';
import { VirtualFileSystem } from './virtualFileSystem';
import type { TerminalController } from '../terminal/terminalController';

interface ActionExecutorOptions {
  onFileOpened?: (path: string) => void;
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

  dispose() {
    this.fs.dispose();
    if (this.highlightTimeout) {
      window.clearTimeout(this.highlightTimeout);
      this.highlightTimeout = null;
    }
    this.editor = null;
    this.monacoInstance = null;
    this.terminal = null;
    this.highlightDecorations = [];
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

    const editor = this.editor;
    const monaco = this.monacoInstance;
    const currentPosition = editor.getPosition() ?? model.getFullModelRange().getEndPosition();
    const range = new monaco.Range(
      currentPosition.lineNumber,
      currentPosition.column,
      currentPosition.lineNumber,
      currentPosition.column,
    );
    const startOffset = model.getOffsetAt(range.getStartPosition());

    editor.executeEdits('timeline-type', [
      {
        range,
        text: action.text,
        forceMoveMarkers: true,
      },
    ]);

    const newPosition = model.getPositionAt(startOffset + action.text.length);
    editor.setPosition(newPosition);
    editor.revealPositionInCenter(newPosition, monaco.editor.ScrollType.Smooth);
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
    this.highlightDecorations = this.editor.deltaDecorations(this.highlightDecorations, [
      {
        range,
        options: {
          inlineClassName: 'timeline-inline-highlight',
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
