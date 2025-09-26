import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';

import type { TimelineAction } from './timeline';
import { TimelineScheduler } from './timeline';
import { ActionExecutor } from './editor/actionExecutor';
import { TerminalController } from './terminal/terminalController';

const DEFAULT_AUDIO_SOURCE = '/demo2.wav';

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

const ACTIVITY_ITEMS = [
  { id: 'explorer', label: 'Files' },
  { id: 'search', label: 'Search' },
  { id: 'run', label: 'Run' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'experience-console', label: 'Experience', togglesConsole: true },
];

const MAJOR_ACTION_KINDS = new Set<TimelineAction['kind']>(['create_file', 'type', 'terminal_run']);

type PlayerStatus = 'idle' | 'running' | 'paused' | 'complete';

type PipelineStage = 'idle' | 'planning' | 'generating' | 'rendering' | 'ready';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  hasPlan?: boolean;
};

const PlanStages: PipelineStage[] = ['planning', 'generating', 'rendering', 'ready'];

const formatTime = (ms: number) => {
  if (!Number.isFinite(ms)) {
    return '0:00';
  }
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString();
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const actionKey = (action: TimelineAction) => action.id ?? `${action.kind}-${action.timeMs}`;

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M8 5.14v13.72c0 .31.17.6.45.76a.84.84 0 0 0 .84-.02L18.4 13.5a.9.9 0 0 0 0-1.5L9.3 4.4A.83.83 0 0 0 8 5.14Z" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M8 5c-.55 0-1 .45-1 1v12c0 .55.45 1 1 1h1.5c.55 0 1-.45 1-1V6c0-.55-.45-1-1-1H8Zm6.5 0c-.55 0-1 .45-1 1v12c0 .55.45 1 1 1H16c.55 0 1-.45 1-1V6c0-.55-.45-1-1-1h-1.5Z" />
    </svg>
  );
}

function ResetIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12a9 9 0 0 1 15.37-6.36" />
      <path d="M3 4v8h8" />
      <path d="M21 12a9 9 0 0 1-15.37 6.36" />
      <path d="M21 20v-8h-8" />
    </svg>
  );
}

function ExperienceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 15h.01" />
      <path d="M12 15h.01" />
      <path d="M16 15h.01" />
    </svg>
  );
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m4 12 3 3 6-6 4 4 3-3" />
    </svg>
  );
}

function App() {
  const [audioSource, setAudioSource] = useState<string>(DEFAULT_AUDIO_SOURCE);
  const audioObjectUrlRef = useRef<string | null>(null);
  const [timelineActions, setTimelineActions] = useState<TimelineAction[]>([]);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [firedKeys, setFiredKeys] = useState<Set<string>>(new Set());
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [editorReady, setEditorReady] = useState(false);
  const [isConsoleOpen, setIsConsoleOpen] = useState(true);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [lastSeekMs, setLastSeekMs] = useState<number | null>(null);
  const [assetsReady, setAssetsReady] = useState(false);
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>('ready');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        "Hey there! Ask for a coding demo and I'll line up the perfect show. When you like the plan, approve it and I'll stage it here in the studio.",
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [assetMessage, setAssetMessage] = useState<string | null>(null);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(true);

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
  const planningTimeoutRef = useRef<number | null>(null);
  const pipelineTimeoutsRef = useRef<number[]>([]);

  const timelineDurationMs = useMemo(() => {
    if (timelineActions.length === 0) {
      return 0;
    }
    return timelineActions[timelineActions.length - 1]?.timeMs ?? 0;
  }, [timelineActions]);

  const majorTimelineActions = useMemo(
    () => timelineActions.filter((action) => MAJOR_ACTION_KINDS.has(action.kind)),
    [timelineActions],
  );

  const fetchShowFromUrl = useCallback(async (url: string) => {
    setAssetsReady(false);
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to load timeline: ${res.status}`);
      }
      const data = await res.json();
      if (!Array.isArray(data?.actions)) {
        throw new Error('Timeline file missing actions array');
      }
      setTimelineActions(data.actions as TimelineAction[]);
      setAssetMessage(`Loaded timeline from ${url}`);
      setAssetsReady(true);
    } catch (error) {
      console.error('Failed to load timeline', error);
      setTimelineError(error instanceof Error ? error.message : 'Unknown error');
      setTimelineActions(FALLBACK_TIMELINE);
      setAssetMessage('Using fallback timeline');
      setAssetsReady(true);
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  useEffect(() => () => {
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    fetchShowFromUrl('/demo2-timeline.json');
  }, [fetchShowFromUrl]);

  useEffect(() => {
    executorRef.current?.reset();
    setFiles([]);
    setActiveFile(null);
    setFiredKeys(new Set());
    setActiveActionKey(null);
    setStatus('idle');
    setCurrentTimeMs(0);
    setLastSeekMs(null);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    schedulerRef.current?.reset();
  }, [timelineActions]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const scheduler = new TimelineScheduler({
      audio,
      actions: timelineActions,
      callbacks: {
        onAction: (action, meta) => {
          executorRef.current?.execute(action);
          setFiredKeys((prev) => {
            const next = new Set(prev);
            next.add(actionKey(action));
            return next;
          });
          setActiveActionKey(actionKey(action));
          setCurrentTimeMs(meta.actualTimeMs);
        },
        onComplete: () => {
          setStatus('complete');
          executorRef.current?.setPlaying(false);
          executorRef.current?.flushTypingNow();
        },
        onSeek: (timeMs) => {
          setCurrentTimeMs(timeMs);
          setLastSeekMs(timeMs);
        },
        onReset: () => {
          setFiredKeys(new Set());
          setActiveActionKey(null);
        },
      },
    });

    schedulerRef.current = scheduler;

    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, [timelineActions]);

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
    return () => {
      if (planningTimeoutRef.current) {
        window.clearTimeout(planningTimeoutRef.current);
        planningTimeoutRef.current = null;
      }
      pipelineTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      pipelineTimeoutsRef.current = [];
    };
  }, []);

  const handleEditorMount = useCallback<OnMount>((editor, monaco) => {
    executorRef.current?.attachEditor(editor, monaco);
    editor.updateOptions({
      readOnly: true,
      domReadOnly: true,
      cursorBlinking: 'solid',
      cursorStyle: 'block',
      smoothScrolling: true,
      minimap: { enabled: false },
      lineNumbers: 'on',
      fontSize: 14,
      renderLineHighlight: 'none',
      wordWrap: 'on',
    });
    setEditorReady(true);
  }, []);

  const handleTogglePlay = useCallback(async () => {
    const audio = audioRef.current;
    const scheduler = schedulerRef.current;
    if (!audio || !scheduler || timelineLoading || !editorReady || !assetsReady) {
      return;
    }

    if (status === 'running') {
      audio.pause();
      scheduler.stop();
      executorRef.current?.setPlaying(false);
      setStatus('paused');
      return;
    }

    try {
      await audio.play();
      scheduler.start();
      executorRef.current?.setPlaying(true);
      setStatus('running');
    } catch (error) {
      console.error('Audio playback failed', error);
    }
  }, [assetsReady, editorReady, status, timelineLoading]);

  const handleReset = useCallback(() => {
    const audio = audioRef.current;
    const scheduler = schedulerRef.current;
    const executor = executorRef.current;
    if (!audio || !scheduler || !executor) {
      return;
    }

    audio.pause();
    audio.currentTime = 0;
    scheduler.reset();
    executor.reset();
    executor.setPlaying(false);
    setFiles([]);
    setActiveFile(null);
    setFiredKeys(new Set());
    setActiveActionKey(null);
    setStatus('idle');
    setCurrentTimeMs(0);
    setLastSeekMs(null);
  }, []);

  const handleTimelineFileSelection = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) {
        return;
      }
      setAssetMessage(`Loading ${file.name}...`);
      setTimelineLoading(true);
      setTimelineError(null);
      setAssetsReady(false);
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed?.actions)) {
          throw new Error('Timeline file missing actions array');
        }
        setTimelineActions(parsed.actions as TimelineAction[]);
        setAssetMessage(`Loaded timeline ${file.name}`);
        setAssetsReady(true);
      } catch (error) {
        console.error('Failed to read timeline file', error);
        setTimelineError(error instanceof Error ? error.message : 'Invalid timeline file');
        setAssetMessage('Failed to load timeline');
        setAssetsReady(timelineActions.length > 0);
      } finally {
        setTimelineLoading(false);
      }
    },
    [timelineActions.length],
  );

  const handleAudioFileSelection = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) {
        return;
      }
      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
        audioObjectUrlRef.current = null;
      }
      const url = URL.createObjectURL(file);
      audioObjectUrlRef.current = url;
      setAudioSource(url);
      setAssetMessage(`Loaded audio ${file.name}`);
      setAssetsReady(timelineActions.length > 0);
      setPipelineStage('ready');
      handleReset();
    },
    [handleReset, timelineActions.length],
  );

  const handleExportTimeline = useCallback(() => {
    if (timelineActions.length === 0) {
      return;
    }
    const blob = new Blob([JSON.stringify({ actions: timelineActions }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'show-timeline.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [timelineActions]);

  const handleResetShow = useCallback(() => {
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
    setAudioSource(DEFAULT_AUDIO_SOURCE);
    setAssetMessage('Restored default show');
    setPipelineStage('ready');
    handleReset();
    fetchShowFromUrl('/demo2-timeline.json');
  }, [fetchShowFromUrl, handleReset]);

  const handleJumpToAction = useCallback(
    (target: TimelineAction) => {
      const scheduler = schedulerRef.current;
      const audio = audioRef.current;
      const executor = executorRef.current;
      if (!scheduler || !audio || !executor) {
        return;
      }

      const targetTime = target.timeMs;
      scheduler.stop();
      audio.pause();
      executor.reset();
      executor.beginBatch();
      setFiles([]);
      setActiveFile(null);
      const executedKeys = new Set<string>();
      let lastKey: string | null = null;

      for (const action of scheduler.getActions()) {
        if (action.timeMs > targetTime) {
          break;
        }
        executor.execute(action);
        const key = actionKey(action);
        executedKeys.add(key);
        lastKey = key;
      }

      audio.currentTime = targetTime / 1000;
      executor.endBatch();
      scheduler.primeAfter(targetTime);
      setFiredKeys(executedKeys);
      setActiveActionKey(lastKey);
      setCurrentTimeMs(targetTime);
      setStatus('paused');
      setLastSeekMs(targetTime);
    },
    [],
  );

  const sendChatMessage = useCallback(() => {
    const trimmed = chatInput.trim();
    if (!trimmed || chatBusy) {
      return;
    }
    const id = `user-${Date.now()}`;
    setChatMessages((prev) => [...prev, { id, role: 'user', content: trimmed }]);
    setChatInput('');
    setChatBusy(true);
    setPipelineStage('planning');

    planningTimeoutRef.current = window.setTimeout(() => {
      const planId = `plan-${Date.now()}`;
      setChatMessages((prev) => [
        ...prev,
        {
          id: planId,
          role: 'assistant',
          hasPlan: true,
          content: `Hey! ${trimmed} sounds great. Here's how I'll stage it:

1. Set the scene with the key file structure.
2. Type through the concepts with inline narration.
3. Wrap up in the terminal with takeaways.

Tap Approve when you're ready for me to spin up the show.`,
        },
      ]);
      setPendingPlanId(planId);
      setChatBusy(false);
      planningTimeoutRef.current = null;
      setPipelineStage('idle');
    }, 900);
  }, [chatBusy, chatInput]);

  const cancelPlanning = useCallback(() => {
    if (planningTimeoutRef.current) {
      window.clearTimeout(planningTimeoutRef.current);
      planningTimeoutRef.current = null;
    }
    pipelineTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    pipelineTimeoutsRef.current = [];
    setChatBusy(false);
    setPendingPlanId(null);
    setPipelineStage('idle');
    setChatMessages((prev) => [
      ...prev,
      {
        id: `cancel-${Date.now()}`,
        role: 'assistant',
        content: 'No worries�canceled that request. Ready when you are.',
      },
    ]);
  }, []);

  const approvePlan = useCallback(() => {
    pipelineTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    pipelineTimeoutsRef.current = [];
    setPendingPlanId(null);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `approve-${Date.now()}`,
        role: 'assistant',
        content: "Awesome�warming up the stage now. You'll see the show queued in just a moment.",
      },
    ]);
    setPipelineStage('generating');
    setAssetsReady(false);
    const generatingTimeout = window.setTimeout(() => setPipelineStage('rendering'), 1200);
    const readyTimeout = window.setTimeout(() => {
      setPipelineStage('ready');
      setAssetsReady(timelineActions.length > 0);
    }, 2400);
    pipelineTimeoutsRef.current.push(generatingTimeout, readyTimeout);
  }, [timelineActions.length]);

  const showPlanActions = pipelineStage !== 'ready' && pipelineStage !== 'idle';
  const disabledForPlayback = timelineLoading || !editorReady || !assetsReady;
  const isPlaying = status === 'running';
  const progressRatio = timelineDurationMs === 0 ? 0 : Math.min(1, currentTimeMs / timelineDurationMs);

  return (
    <div className="ide-root">
      <audio ref={audioRef} src={audioSource} preload="auto" />
      <div className="ide-shell">
        <aside className="activity-bar">
          {ACTIVITY_ITEMS.map((item) => {
            const isExperience = item.togglesConsole;
            const isRun = item.id === 'run';
            const isActive = isExperience ? isConsoleOpen : isRun ? runMenuOpen : item.id === 'explorer';
            return (
              <button
                key={item.id}
                type="button"
                className={`activity-button ${isActive ? 'activity-button-active' : ''}`}
                title={item.label}
                onClick={() => {
                  if (isExperience) {
                    setIsConsoleOpen((prev) => !prev);
                  } else if (isRun) {
                    setRunMenuOpen((prev) => !prev);
                  }
                }}
              >
                {isExperience ? <ExperienceIcon className="w-5 h-5" /> : <ActivityIcon className="w-5 h-5" />}
                <span className="sr-only">{item.label}</span>
              </button>
            );
          })}
        </aside>

        <aside className="explorer-panel">
          <header className="explorer-header">EXPLORER</header>
          <div className="explorer-body">
            {files.length === 0 ? (
              <p className="explorer-empty">Files will appear as the show unfolds.</p>
            ) : (
              <ul className="explorer-list">
                {files.map((file) => (
                  <li key={file}>
                    <button
                      type="button"
                      className={`explorer-item ${activeFile === file ? 'explorer-item-active' : ''}`}
                      onClick={() => executorRef.current?.focusFile(file)}
                    >
                      {file}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <main className="editor-stack">
          <div className="tab-strip">
            {files.length === 0 ? (
              <div className="tab-placeholder">Waiting for the first cue...</div>
            ) : (
              files.map((file) => (
                <button
                  type="button"
                  key={`tab-${file}`}
                  className={`tab ${activeFile === file ? 'tab-active' : ''}`}
                  onClick={() => executorRef.current?.focusFile(file)}
                >
                  {file}
                </button>
              ))
            )}
          </div>
          <div className="editor-surface">
            <Editor
              height="100%"
              defaultLanguage="typescript"
              theme="vs-dark"
              options={{
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                minimap: { enabled: false },
                readOnly: true,
                domReadOnly: true,
              }}
              onMount={handleEditorMount}
            />
          </div>
          <div className="terminal-panel">
            <header className="terminal-header">TERMINAL</header>
            <div ref={terminalContainerRef} className="terminal-body" />
          </div>
        </main>

        {isConsoleOpen ? (
          <aside className="experience-console">
            <section className="player-panel">
              <header className="player-header">
                <div>
                  <p className="player-title">Show Player</p>
                  <p className="player-subtitle">{assetsReady ? 'Ready to play' : 'Preparing assets...'}</p>
                </div>
                <div className="player-controls">
                  <button
                    type="button"
                    className={`icon-button ${disabledForPlayback ? 'icon-button-disabled' : ''}`}
                    onClick={handleTogglePlay}
                    disabled={disabledForPlayback}
                  >
                    {isPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />}
                    <span className="sr-only">{isPlaying ? 'Pause' : 'Play'}</span>
                  </button>
                  <button type="button" className="icon-button" onClick={handleReset}>
                    <ResetIcon className="w-5 h-5" />
                    <span className="sr-only">Reset</span>
                  </button>
                </div>
              </header>
              <div className="player-progress">
                <div className="player-progress-bar">
                  <div className="player-progress-fill" style={{ width: `${progressRatio * 100}%` }} />
                </div>
                <div className="player-progress-meta">
                  <span>{formatTime(currentTimeMs)}</span>
                  <span>{formatTime(timelineDurationMs)}</span>
                </div>
              </div>
              {timelineError ? <p className="player-warning">Timeline fallback in use: {timelineError}</p> : null}
            </section>

            <section className="timeline-panel">
              <header className="panel-header">
                <button type="button" className="chapters-toggle" onClick={() => setChaptersOpen((p) => !p)}>
                  {chaptersOpen ? '▾' : '▸'}
                </button>
                <span>Chapters</span>
              </header>
              <div className={`timeline-list ${chaptersOpen ? '' : 'hidden'}`}>
                {majorTimelineActions.length === 0 ? (
                  <p className="timeline-empty">Timeline cues will populate once the show starts.</p>
                ) : (
                  <ul>
                    {majorTimelineActions.map((action) => {
                      const key = actionKey(action);
                      const isComplete = firedKeys.has(key);
                      const isActive = activeActionKey === key;
                      return (
                        <li key={key}>
                          <button
                            type="button"
                            className={`timeline-item ${isActive ? 'timeline-item-active' : isComplete ? 'timeline-item-complete' : ''}`}
                            onClick={() => handleJumpToAction(action)}
                          >
                            <span className="timeline-item-label">{action.kind.replace('_', ' ')}</span>
                            <span className="timeline-item-time">{formatTime(action.timeMs)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {lastSeekMs !== null ? <p className="timeline-note">Queued at {formatTime(lastSeekMs)}</p> : null}
            </section>

            <section className="chat-panel">
              <header className="panel-header">Director Chat</header>
              <div className="quick-shows">
                <button
                  type="button"
                  className="quick-show-button"
                  onClick={() => {
                    setAssetMessage('Loading demo show...');
                    fetchShowFromUrl('/demo2-timeline.json');
                  }}
                >
                  Play Demo
                </button>
              </div>
              <div className="chat-log">
                {chatMessages.map((message) => (
                  <div key={message.id} className={`chat-bubble chat-${message.role}`}>
                    <p>{message.content}</p>
                    {message.hasPlan && pendingPlanId === message.id ? (
                      <div className="chat-actions">
                        <button type="button" className="chat-button-primary" onClick={approvePlan}>
                          Approve show plan
                        </button>
                        <button type="button" className="chat-button" onClick={cancelPlanning}>
                          Cancel
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              <form
                className="chat-input"
                onSubmit={(event) => {
                  event.preventDefault();
                  sendChatMessage();
                }}
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Ask for the next show..."
                  disabled={chatBusy}
                />
                <button type="submit" className="chat-send" disabled={chatBusy}>
                  Send
                </button>
                {showPlanActions ? (
                  <div className="pipeline-chips">
                    {PlanStages.map((stage) => (
                      <span key={stage} className={`chip ${pipelineStage === stage ? 'chip-active' : ''}`}>
                        {stage.charAt(0).toUpperCase() + stage.slice(1)}
                      </span>
                    ))}
                    <button type="button" className="chat-button" onClick={cancelPlanning}>
                      Cancel
                    </button>
                  </div>
                ) : null}
              </form>
            </section>
          </aside>
        ) : null}
        {runMenuOpen ? (
          <div className="run-menu" onMouseLeave={() => setRunMenuOpen(false)}>
            {assetMessage ? <p className="assets-message">{assetMessage}</p> : null}
            <button type="button" className="run-item" onClick={() => setRunMenuOpen(false)}>
              <label className="assets-upload inline">
                <input type="file" accept="application/json,.json" onChange={handleTimelineFileSelection} />
                <span>Import timeline</span>
              </label>
            </button>
            <button type="button" className="run-item" onClick={() => setRunMenuOpen(false)}>
              <label className="assets-upload inline">
                <input type="file" accept="audio/*" onChange={handleAudioFileSelection} />
                <span>Import audio</span>
              </label>
            </button>
            <button type="button" className="run-item" onClick={() => { handleExportTimeline(); setRunMenuOpen(false); }} disabled={timelineActions.length === 0}>
              Export timeline
            </button>
            <button type="button" className="run-item" onClick={() => { handleResetShow(); setRunMenuOpen(false); }}>
              Restore default show
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default App;


