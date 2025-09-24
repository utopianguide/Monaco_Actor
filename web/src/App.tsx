import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';

import type { FiredActionMeta, TimelineAction } from './timeline';
import { TimelineScheduler } from './timeline';
import { ActionExecutor } from './editor/actionExecutor';
import { TerminalController } from './terminal/terminalController';

type PlayerStatus = 'idle' | 'running' | 'paused' | 'complete';

interface FiredActionLog {
  action: TimelineAction;
  meta: FiredActionMeta;
}

const FALLBACK_TIMELINE: TimelineAction[] = [
  {
    id: 'fallback-create',
    kind: 'create_file',
    path: 'demo.ts',
    timeMs: 0,
  },
  {
    id: 'fallback-type',
    kind: 'type',
    path: 'demo.ts',
    text: "console.log('Fallback timeline');\n",
    timeMs: 400,
  },
];

const activityBarItems = ['files', 'search', 'git', 'run', 'extensions'];

const formatTime = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

const actionKey = (action: TimelineAction) => action.id ?? `${action.kind}-${action.timeMs}`;

const formatActionLabel = (kind: TimelineAction['kind']) =>
  kind
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const deriveFiles = (actions: TimelineAction[]) => {
  const files = new Set<string>();
  for (const action of actions) {
    if ('path' in action && typeof action.path === 'string') {
      files.add(action.path);
    }
  }
  return Array.from(files).sort((a, b) => a.localeCompare(b));
};

function App() {
  const [timelineActions, setTimelineActions] = useState<TimelineAction[]>([]);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [firedActions, setFiredActions] = useState<FiredActionLog[]>([]);
  const [lastSeekMs, setLastSeekMs] = useState<number | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [editorReady, setEditorReady] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);

  const executorRef = useRef<ActionExecutor | null>(null);
  if (!executorRef.current) {
    executorRef.current = new ActionExecutor({
      onFileOpened: (path) => setActiveFile(path),
      onFileCreated: (path) =>
        setFiles((prev) => {
          if (prev.includes(path)) {
            return prev;
          }
          return [...prev, path].sort((a, b) => a.localeCompare(b));
        }),
    });
  }

  const audioRef = useRef<HTMLAudioElement>(null);
  const schedulerRef = useRef<TimelineScheduler | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalControllerRef = useRef<TerminalController | null>(null);

  const timelineDurationMs = useMemo(() => {
    if (timelineActions.length === 0) {
      return 0;
    }
    return timelineActions[timelineActions.length - 1]?.timeMs ?? 0;
  }, [timelineActions]);

  const derivedFiles = useMemo(() => deriveFiles(timelineActions), [timelineActions]);

  useEffect(() => {
    setFiles((prev) => {
      if (prev.length === derivedFiles.length && prev.every((value, index) => value === derivedFiles[index])) {
        return prev;
      }
      return derivedFiles;
    });
  }, [derivedFiles]);

  useEffect(() => {
    if (!activeFile && derivedFiles.length > 0) {
      setActiveFile(derivedFiles[0]);
    }
  }, [activeFile, derivedFiles]);

  useEffect(() => {
    let cancelled = false;
    const loadTimeline = async () => {
      setTimelineLoading(true);
      setTimelineError(null);
      try {
        const res = await fetch('/demo-timeline.json');
        if (!res.ok) {
          throw new Error(`Failed to load timeline: ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled && Array.isArray(data.actions)) {
          setTimelineActions(data.actions as TimelineAction[]);
        }
      } catch (error) {
        console.error('Failed to load timeline', error);
        if (!cancelled) {
          setTimelineError(error instanceof Error ? error.message : 'Unknown error');
          setTimelineActions(FALLBACK_TIMELINE);
        }
      } finally {
        if (!cancelled) {
          setTimelineLoading(false);
        }
      }
    };

    void loadTimeline();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const container = terminalContainerRef.current;
    const executor = executorRef.current;
    if (!container || !executor) {
      return;
    }

    const controller = new TerminalController();
    controller.mount(container);
    executor.attachTerminal(controller);
    terminalControllerRef.current = controller;

    return () => {
      controller.dispose();
      executor.attachTerminal(null);
      terminalControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const handleTimeUpdate = () => {
      setCurrentTimeMs(audio.currentTime * 1000);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('seeked', handleTimeUpdate);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('seeked', handleTimeUpdate);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const scheduler = new TimelineScheduler({
      audio,
      callbacks: {
        onAction: (action, meta) => {
          executorRef.current?.execute(action);
          setFiredActions((prev) => [...prev, { action, meta }]);
        },
        onComplete: () => {
          setStatus('complete');
        },
        onSeek: (timeMs) => {
          setLastSeekMs(timeMs);
          setCurrentTimeMs(timeMs);
        },
        onReset: () => {
          setFiredActions([]);
          setStatus('idle');
          setCurrentTimeMs(0);
        },
      },
    });

    schedulerRef.current = scheduler;

    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler) {
      return;
    }
    scheduler.setActions(timelineActions);
    setFiredActions([]);
    setStatus('idle');
    setLastSeekMs(null);
    setCurrentTimeMs(0);
  }, [timelineActions]);

  const handleEditorMount = useCallback<OnMount>((editor, monaco) => {
    executorRef.current?.attachEditor(editor, monaco);
    editor.updateOptions({
      readOnly: false,
      fontLigatures: true,
      cursorBlinking: 'smooth',
      automaticLayout: true,
    });
    setEditorReady(true);
  }, []);

  const handlePlay = useCallback(async () => {
    const audio = audioRef.current;
    const scheduler = schedulerRef.current;
    if (!audio || !scheduler) {
      return;
    }
    if (!editorReady) {
      console.warn('Editor not ready yet.');
      return;
    }
    try {
      await audio.play();
      scheduler.start();
      setStatus('running');
    } catch (error) {
      console.error('Audio playback failed', error);
    }
  }, [editorReady]);

  const handlePause = useCallback(() => {
    const audio = audioRef.current;
    const scheduler = schedulerRef.current;
    if (!audio || !scheduler) {
      return;
    }
    audio.pause();
    scheduler.stop();
    setStatus('paused');
  }, []);

  const handleReset = useCallback(() => {
    const audio = audioRef.current;
    const scheduler = schedulerRef.current;
    if (!audio || !scheduler) {
      return;
    }
    audio.pause();
    audio.currentTime = 0;
    scheduler.reset();
    setLastSeekMs(null);
    setCurrentTimeMs(0);
  }, []);

  const handleFileClick = useCallback((path: string) => {
    executorRef.current?.focusFile(path);
  }, []);

  const progressRatio = useMemo(() => {
    if (!timelineDurationMs) {
      return 0;
    }
    return Math.min(1, currentTimeMs / timelineDurationMs);
  }, [currentTimeMs, timelineDurationMs]);

  const firedKeys = useMemo(() => new Set(firedActions.map(({ action }) => actionKey(action))), [firedActions]);
  const lastFiredKey = firedActions.length > 0 ? actionKey(firedActions[firedActions.length - 1].action) : null;

  return (
    <div className="vs-root flex min-h-screen bg-[#1e1e1e] text-[#cccccc]">
      <audio ref={audioRef} src="/demo.mp3" preload="auto" className="hidden" />
      <aside className="hidden w-12 flex-col items-center gap-4 bg-[#202020] py-4 md:flex">
        {activityBarItems.map((item) => (
          <div
            key={item}
            className="flex h-8 w-8 items-center justify-center rounded text-[11px] uppercase tracking-[0.2em] text-[#8c8c8c] hover:bg-[#333333] hover:text-white"
            title={item}
          >
            {item.charAt(0)}
          </div>
        ))}
      </aside>
      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-64 flex-col border-r border-[#2a2a2a] bg-[#252526] md:flex">
          <div className="border-b border-[#2a2a2a] px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-[#858585]">
            Explorer
          </div>
          <div className="px-4 py-3 text-xs font-semibold text-[#bdbdbd]">MONACO ACTOR</div>
          <nav className="flex-1 overflow-y-auto px-2 pb-4">
            {files.map((file) => (
              <button
                key={file}
                onClick={() => handleFileClick(file)}
                className={`group flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm transition ${
                  activeFile === file
                    ? 'bg-[#37373d] text-white'
                    : 'text-[#cccccc] hover:bg-[#2d2d30] hover:text-white'
                }`}
              >
                <span>{file}</span>
              </button>
            ))}
            {files.length === 0 ? (
              <p className="px-3 py-2 text-sm text-[#8a8a8a]">Timeline will generate files during playback.</p>
            ) : null}
          </nav>
        </aside>
        <main className="flex flex-1 flex-col bg-[#1e1e1e]">
          <header className="flex h-10 items-center gap-1 border-b border-[#2a2a2a] bg-[#1f1f1f] px-4">
            {files.map((file) => (
              <button
                key={`tab-${file}`}
                onClick={() => handleFileClick(file)}
                className={`flex items-center gap-2 rounded-t px-3 py-1 text-xs font-medium transition ${
                  activeFile === file
                    ? 'bg-[#1e1e1e] text-[#ffffff]'
                    : 'text-[#9d9d9d] hover:bg-[#2d2d30] hover:text-white'
                }`}
              >
                <span>{file}</span>
              </button>
            ))}
            <div className="ml-auto text-xs text-[#999999]">Status: {status}</div>
          </header>
          <div className="flex flex-1 flex-col">
            <div className="flex-1">
              <Editor
                height="100%"
                defaultLanguage="typescript"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  readOnly: false,
                  smoothScrolling: true,
                  scrollBeyondLastLine: false,
                }}
                theme="vs-dark"
                onMount={handleEditorMount}
              />
            </div>
            <div className="h-44 border-t border-[#2a2a2a] bg-[#1b1b1b]">
              <div className="flex h-9 items-center border-b border-[#2a2a2a] px-4 text-xs font-semibold uppercase tracking-[0.2em] text-[#9f9f9f]">
                Terminal
              </div>
              <div ref={terminalContainerRef} className="h-[calc(100%-2.25rem)] px-2 py-2" />
            </div>
          </div>
        </main>
        <aside className="flex w-80 flex-col border-l border-[#2a2a2a] bg-[#1b1b1f]">
          <div className="border-b border-[#2a2a2a] px-4 py-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.35em] text-[#8a8a8a]">Timeline Player</h2>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={handlePlay}
                disabled={timelineLoading || !editorReady}
                className="rounded bg-[#0e639c] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#1177bb] disabled:cursor-not-allowed disabled:bg-[#3a3d41] disabled:text-[#9d9d9d]"
              >
                Play
              </button>
              <button
                onClick={handlePause}
                disabled={timelineLoading}
                className="rounded border border-[#3c3c3c] px-3 py-1.5 text-sm font-medium text-[#cccccc] transition hover:border-[#555555] disabled:cursor-not-allowed disabled:border-[#2d2d30] disabled:text-[#757575]"
              >
                Pause
              </button>
              <button
                onClick={handleReset}
                disabled={timelineLoading}
                className="rounded border border-[#3c3c3c] px-3 py-1.5 text-sm font-medium text-[#cccccc] transition hover:border-[#555555] disabled:cursor-not-allowed disabled:border-[#2d2d30] disabled:text-[#757575]"
              >
                Reset
              </button>
            </div>
            <div className="mt-4">
              <div className="h-1 w-full overflow-hidden rounded-full bg-[#2d2d30]">
                <div className="h-full bg-[#0e639c]" style={{ width: `${progressRatio * 100}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-[#9f9f9f]">
                <span>{formatTime(currentTimeMs)}</span>
                <span>{formatTime(timelineDurationMs)}</span>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[#a6a6a6]">
              <div className="rounded border border-[#2d2d30] bg-[#202025] px-3 py-2">
                <span className="block text-[10px] uppercase tracking-[0.2em] text-[#777777]">Actions</span>
                <span className="mt-1 text-sm text-white">{timelineActions.length}</span>
              </div>
              <div className="rounded border border-[#2d2d30] bg-[#202025] px-3 py-2">
                <span className="block text-[10px] uppercase tracking-[0.2em] text-[#777777]">Last Drift</span>
                <span className="mt-1 text-sm text-white">
                  {firedActions.length > 0
                    ? `${firedActions[firedActions.length - 1].meta.driftMs.toFixed(1)}ms`
                    : '—'}
                </span>
              </div>
            </div>
            {timelineError ? (
              <p className="mt-3 text-xs text-[#dcdcaa]">Timeline fallback in use: {timelineError}</p>
            ) : null}
            {lastSeekMs !== null ? (
              <p className="mt-2 text-[11px] text-[#9f9f9f]">Last seek: {formatTime(lastSeekMs)}</p>
            ) : null}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8a8a8a]">Timeline</h3>
              <ul className="mt-3 space-y-2 text-xs">
                {timelineActions.map((action) => {
                  const key = actionKey(action);
                  const hasFired = firedKeys.has(key);
                  const isActive = lastFiredKey === key;
                  return (
                    <li
                      key={key}
                      className={`rounded border px-3 py-2 transition ${
                        isActive
                          ? 'border-[#0e639c] bg-[#094771] text-white'
                          : hasFired
                          ? 'border-[#2f2f2f] bg-[#252526] text-[#bdbdbd]'
                          : 'border-[#2a2a2a] bg-[#1f1f1f] text-[#9f9f9f]'
                      }`}
                    >
                      <div className="flex justify-between font-medium text-[11px] uppercase tracking-wide">
                        <span>{formatActionLabel(action.kind)}</span>
                        <span>{formatTime(action.timeMs)}</span>
                      </div>
                      {'path' in action && action.path ? (
                        <div className="mt-1 truncate text-[11px] text-[#dcdcaa]">{action.path}</div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8a8a8a]">Fired Actions</h3>
              <div className="mt-3 max-h-60 overflow-y-auto rounded border border-[#2a2a2a] bg-[#1f1f1f]">
                {firedActions.length === 0 ? (
                  <div className="flex h-24 items-center justify-center px-4 text-center text-[11px] text-[#8a8a8a]">
                    Actions will appear here during playback.
                  </div>
                ) : (
                  <ul className="divide-y divide-[#2a2a2a] text-xs">
                    {[...firedActions].reverse().map(({ action, meta }, index) => (
                      <li key={`${actionKey(action)}-${index}`} className="px-3 py-2 text-[#bdbdbd]">
                        <div className="flex justify-between font-medium text-[11px] uppercase tracking-wide">
                          <span>{formatActionLabel(action.kind)}</span>
                          <span>{formatTime(meta.actualTimeMs)}</span>
                        </div>
                        <div className="mt-1 flex justify-between text-[11px] text-[#8a8a8a]">
                          <span>Scheduled: {formatTime(meta.scheduledTimeMs)}</span>
                          <span>Drift: {meta.driftMs.toFixed(1)}ms</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;