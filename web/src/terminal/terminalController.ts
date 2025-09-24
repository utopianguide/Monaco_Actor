import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

export class TerminalController {
  private term = new Terminal({
    cols: 80,
    rows: 18,
    convertEol: true,
    cursorBlink: true,
    fontFamily: 'Cascadia Code, Consolas, Menlo, monospace',
    fontSize: 13,
    theme: {
      background: '#1b1b1b',
      foreground: '#d4d4d4',
      cursor: '#0e639c',
      selectionBackground: '#264f78',
    },
  });
  private fitAddon = new FitAddon();
  private container: HTMLDivElement | null = null;
  private resizeHandler = () => this.fitAddon.fit();

  constructor() {
    this.term.loadAddon(this.fitAddon);
  }

  mount(container: HTMLDivElement) {
    if (this.container === container) {
      return;
    }
    this.container = container;
    this.term.open(container);
    this.fitAddon.fit();
    window.addEventListener('resize', this.resizeHandler);
  }

  dispose() {
    window.removeEventListener('resize', this.resizeHandler);
    this.term.dispose();
    this.container = null;
  }

  runCommand(command: string) {
    this.write(`$ ${command}\r\n`);
  }

  write(text: string) {
    this.term.write(text.replace(/\n/g, '\r\n'));
  }

  clear() {
    this.term.clear();
  }
}