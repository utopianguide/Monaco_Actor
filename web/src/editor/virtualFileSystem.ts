import type * as monaco from 'monaco-editor';

export class VirtualFileSystem {
  private monacoInstance: typeof monaco | null = null;
  private models = new Map<string, monaco.editor.ITextModel>();
  private openedPath: string | null = null;

  attach(monacoInstance: typeof monaco) {
    this.monacoInstance = monacoInstance;
  }

  dispose() {
    for (const model of this.models.values()) {
      model.dispose();
    }
    this.models.clear();
    this.openedPath = null;
    this.monacoInstance = null;
  }

  createFile(path: string, content = '') {
    return this.getOrCreateModel(path, content);
  }

  openFile(path: string) {
    const model = this.getOrCreateModel(path);
    this.openedPath = path;
    return model;
  }

  markOpened(path: string | null) {
    this.openedPath = path;
  }

  appendText(path: string, text: string) {
    const monaco = this.assertMonaco();
    const model = this.getOrCreateModel(path);
    const end = model.getFullModelRange().getEndPosition();
    model.applyEdits([
      {
        range: new monaco.Range(end.lineNumber, end.column, end.lineNumber, end.column),
        text,
        forceMoveMarkers: true,
      },
    ]);
    return model;
  }

  setText(path: string, text: string) {
    const model = this.getOrCreateModel(path);
    model.setValue(text);
    return model;
  }

  getModel(path: string) {
    return this.models.get(path) ?? null;
  }

  listFiles() {
    return Array.from(this.models.keys()).sort();
  }

  getOpenedPath() {
    return this.openedPath;
  }

  private getOrCreateModel(path: string, content = '') {
    const monaco = this.assertMonaco();
    const existing = this.models.get(path);
    if (existing) {
      if (content && existing.getValue() !== content) {
        existing.setValue(content);
      }
      return existing;
    }

    const uri = monaco.Uri.file(path);
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, undefined, uri);
    this.models.set(path, model);
    return model;
  }

  private assertMonaco(): typeof monaco {
    if (!this.monacoInstance) {
      throw new Error('Monaco has not been attached yet.');
    }
    return this.monacoInstance;
  }
}
