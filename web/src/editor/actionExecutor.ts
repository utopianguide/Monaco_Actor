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
  private fileCursors = new Map<string, { line: number; column: number }>();
  private typingAnimations = new Map<string, { timeout: number; isTyping: boolean }>();
  private isReplaying = false;

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
    this.fileCursors.clear();
    
    // Clear all typing animations
    for (const animation of this.typingAnimations.values()) {
      if (animation.timeout) {
        window.clearTimeout(animation.timeout);
      }
    }
    this.typingAnimations.clear();
    
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
        this.fileCursors.set(action.path, { line: 1, column: 1 });
        this.options.onFileCreated?.(action.path);
        break;
      }
      case 'open_file': {
        const model = this.fs.openFile(action.path);
        this.openModel(model, action.path);
        break;
      }
      case 'type': {
        if (this.isReplaying) {
          this.applyTypeActionInstant(action);
        } else {
          this.applyTypeAction(action);
        }
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

  setReplaying(isReplaying: boolean) {
    this.isReplaying = isReplaying;
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

    // Calculate typing speed
    const getTypingSpeed = (action: TypeAction): number => {
      if (action.typingSpeedMs) return action.typingSpeedMs;
      if (action.speed === 'fast') return 25;
      if (action.speed === 'slow') return 150;
      if (typeof action.speed === 'number') return action.speed;
      return 50; // default normal speed
    };

    const typingSpeed = getTypingSpeed(action);
    const monaco = this.monacoInstance;
    const editor = this.editor;
    
    // Get the tracked cursor position for this file, or default to start
    const cursor = this.fileCursors.get(action.path) ?? { line: 1, column: 1 };
    const startPosition = new monaco.Position(cursor.line, cursor.column);
    
    // Clear any existing typing animation for this path
    const existingAnimation = this.typingAnimations.get(action.path);
    if (existingAnimation) {
      if (existingAnimation.timeout) {
        window.clearTimeout(existingAnimation.timeout);
      }
    }
    
    // Start typing animation
    this.startTypingAnimation(action.path, action.text, startPosition, typingSpeed, model, editor, monaco);
  }

  private startTypingAnimation(
    path: string,
    text: string,
    startPosition: monaco.Position,
    typingSpeed: number,
    model: monaco.editor.ITextModel,
    editor: monaco.editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor')
  ) {
    let currentIndex = 0;
    const animation = { timeout: 0, isTyping: true };
    this.typingAnimations.set(path, animation);
    
    const typeNextChar = () => {
      if (!animation.isTyping || currentIndex >= text.length) {
        // Animation finished or was cancelled
        this.typingAnimations.delete(path);
        return;
      }
      
      const char = text[currentIndex];
      currentIndex++;
      
      // Get current cursor position for this file
      const cursor = this.fileCursors.get(path) ?? { line: startPosition.lineNumber, column: startPosition.column };
      const insertPosition = new monaco.Position(cursor.line, cursor.column);
      
      const insertRange = new monaco.Range(
        insertPosition.lineNumber,
        insertPosition.column,
        insertPosition.lineNumber,
        insertPosition.column,
      );
      const startOffset = model.getOffsetAt(insertRange.getStartPosition());
      
      // Insert the character
      model.pushEditOperations(
        [],
        [
          {
            range: insertRange,
            text: char,
            forceMoveMarkers: true,
          },
        ],
        () => null,
      );
      
      const newPosition = model.getPositionAt(startOffset + 1);
      
      // Update tracked cursor position
      this.fileCursors.set(path, {
        line: newPosition.lineNumber,
        column: newPosition.column
      });
      
      // Update editor cursor and scroll
      if (this.fs.getOpenedPath() === path) {
        editor.setPosition(newPosition);
        editor.revealPositionInCenter(newPosition, monaco.editor.ScrollType.Smooth);
      }
      
      // Schedule next character
      if (currentIndex < text.length) {
        animation.timeout = window.setTimeout(typeNextChar, typingSpeed);
      } else {
        this.typingAnimations.delete(path);
      }
    };
    
    // Start typing immediately
    typeNextChar();
  }

  stopTypingAnimation(path: string) {
    const animation = this.typingAnimations.get(path);
    if (animation) {
      animation.isTyping = false;
      if (animation.timeout) {
        window.clearTimeout(animation.timeout);
      }
      this.typingAnimations.delete(path);
    }
  }

  private applyTypeActionInstant(action: TypeAction) {
    const model = this.ensureFileOpen(action.path);
    if (!model || !this.editor || !this.monacoInstance) {
      return;
    }

    const monaco = this.monacoInstance;
    const editor = this.editor;
    
    // Get the tracked cursor position for this file, or default to start
    const cursor = this.fileCursors.get(action.path) ?? { line: 1, column: 1 };
    const insertPosition = new monaco.Position(cursor.line, cursor.column);
    
    const insertRange = new monaco.Range(
      insertPosition.lineNumber,
      insertPosition.column,
      insertPosition.lineNumber,
      insertPosition.column,
    );
    const startOffset = model.getOffsetAt(insertRange.getStartPosition());

    model.pushEditOperations(
      [],
      [
        {
          range: insertRange,
          text: action.text,
          forceMoveMarkers: true,
        },
      ],
      () => null,
    );

    const newPosition = model.getPositionAt(startOffset + action.text.length);
    
    // Update tracked cursor position for this file
    this.fileCursors.set(action.path, {
      line: newPosition.lineNumber,
      column: newPosition.column
    });
    
    // Only update editor if this file is currently open
    if (this.fs.getOpenedPath() === action.path) {
      editor.setPosition(newPosition);
      editor.revealPositionInCenter(newPosition, monaco.editor.ScrollType.Smooth);
    }
  }

  private applyMoveCursor(action: MoveCursorAction) {
    const model = this.ensureFileOpen(action.path);
    if (!model || !this.editor || !this.monacoInstance) {
      return;
    }
    const position = new this.monacoInstance.Position(action.line, action.column);
    
    // Update tracked cursor position for this file
    this.fileCursors.set(action.path, {
      line: action.line,
      column: action.column
    });
    
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
