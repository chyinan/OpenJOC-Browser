// pattern: Imperative Shell

import {type PlaybackMetrics, type PlaybackPhase} from './extension-protocol.js';
import {advanceOverlayState, createOverlayState, needsOverlayMarkupRebuild, overlayRendererLabel, resetOverlayState, OVERLAY_RENDERER_OPTIONS, type DialnormMode, type OverlayRenderer, type OverlayState} from './joc-overlay-state.js';
import {normalizeOutputGainDb, OUTPUT_GAIN_MIN_DB, OUTPUT_GAIN_MAX_DB, OUTPUT_GAIN_STEP_DB} from './output-gain.js';

type OverlayStatus = Readonly<{
  readonly phase: PlaybackPhase;
  readonly reason: string | null;
  readonly inbandJocConfirmed: boolean;
  readonly profile: string | null;
  readonly metrics: PlaybackMetrics;
}>;

type OverlayEnableOptions = Readonly<{
  readonly renderer: OverlayRenderer;
  readonly dialnorm: DialnormMode;
}>;

type JocOverlayCallbacks = Readonly<{
  readonly onEnable: (options: OverlayEnableOptions) => void;
  readonly onDisable: () => void;
  readonly onRendererChange: (renderer: OverlayRenderer) => void;
  readonly onDialnormChange: (mode: DialnormMode) => void;
  readonly onAlwaysEnabledChange: (enabled: boolean) => void;
  readonly onGainChange: (gainDb: number) => void;
  readonly onReturnNative: () => void;
}>;

export type JocOverlayController = Readonly<{
  readonly setManifest: (hasJoc: boolean) => void;
  readonly setAlwaysEnabled: (enabled: boolean) => void;
  readonly setDialnorm: (mode: DialnormMode) => void;
  readonly setRenderer: (renderer: OverlayRenderer) => void;
  readonly setGainDb: (gainDb: number) => void;
  readonly setDebugSummary: (summary: string) => void;
  readonly setRequested: (isRequested: boolean) => void;
  readonly setStatus: (status: OverlayStatus | null) => void;
  readonly toggleManually: () => void;
  readonly reset: () => void;
}>;

const OVERLAY_SAMPLE_RATE = 48_000;
let binauralDiagnosticsMarkup = '';
let alwaysEnabledMarkup = '';

export function createJocOverlayController(callbacks: JocOverlayCallbacks): JocOverlayController {
  const panel = document.createElement('div');
  const shadow = panel.attachShadow({mode: 'closed'});
  const style = document.createElement('style');
  style.textContent = OVERLAY_STYLE;
  shadow.append(style);

  const panelBody = document.createElement('div');
  panelBody.className = 'panel';
  panelBody.setAttribute('role', 'region');
  panelBody.setAttribute('aria-label', 'OpenJOC 音频控制器');
  panelBody.hidden = true;
  shadow.append(panelBody);
  panel.dataset.openjoc = 'control';
  document.documentElement.append(panel);

  let state: OverlayState = createOverlayState();
  let status: OverlayStatus | null = null;
  let copyStatusTimer: number | null = null;

  function updateDebugState(): void {
    panel.dataset.openjocState = JSON.stringify({
      schemaVersion: 1,
      mode: state.mode,
      hasJoc: state.hasJoc,
      detectionDismissed: state.detectionDismissed,
      errorDetailsOpen: state.errorDetailsOpen,
      renderer: state.renderer,
      dialnorm: state.dialnorm,
      gainDb: state.gainDb,
      alwaysEnabled: state.alwaysEnabled,
      statusPhase: status?.phase ?? null,
      statusReason: status?.reason ?? null,
    });
  }

  function render(): void {
    panelBody.hidden = state.mode === 'hidden';
    panelBody.dataset.mode = state.mode;
    panelBody.classList.toggle('detected', state.mode === 'detected');
    panelBody.innerHTML = renderMode(state, status);
    updateDebugState();
  }

  function transition(event: Parameters<typeof advanceOverlayState>[1]): void {
    state = advanceOverlayState(state, event);
    render();
  }

  function updateLiveStatus(): void {
    updateDebugState();
    const metrics = status?.metrics ?? null;
    const health = healthValues(metrics);
    setLiveText('status-label', playbackStatusLabel(status));
    const syncElement = setLiveText('health-sync', health.driftLabel);
    syncElement?.classList.remove('good', 'warn');
    if (health.driftClass !== '') syncElement?.classList.add(health.driftClass);
    setLiveText('health-loudness', health.loudnessLabel);
    setLiveText('diag-status', playbackStatusLabel(status));
    setLiveText('diag-profile', status?.profile ?? '等待 JOC 配置');
    setLiveText('diag-stage', status?.metrics.stage ?? '—');
    setLiveText('diag-drift', metrics?.driftMs === null || metrics === null ? '—' : `${formatNumber(metrics.driftMs, 1)} ms`);
    setLiveText('diag-loudness', metrics?.averageDb === null || metrics === null ? '—' : `${formatNumber(metrics.averageDb, 1)} dB`);
    setLiveText('diag-buffer', metrics === null ? '—' : formatDuration(metrics.pcmBufferMs));
    setLiveText('diag-underruns', metrics === null ? '—' : formatInteger(metrics.underrunCount));
    setLiveText('diag-decode-p95', metrics === null ? '—' : `${formatNumber(metrics.decodeP95Ms, 1)} ms`);
    setLiveText('diag-realtime', metrics?.realtimeFactor === null || metrics === null ? '—' : `${formatNumber(metrics.realtimeFactor, 2)}×`);
    setLiveText('diag-memory', metrics === null ? '—' : formatBytes(metrics.peakWasmMemoryBytes));
    setLiveText('diag-memory-peak', metrics === null ? '—' : formatBytes(metrics.peakWasmMemoryBytes));
    setLiveText('diag-binaural-latency', metrics?.binauralLatencyMs === null || metrics === null ? '—' : `${formatNumber(metrics.binauralLatencyMs, 2)} ms`);
    setLiveText('diag-binaural-p95', metrics?.binauralP95Ms === null || metrics === null ? '—' : `${formatNumber(metrics.binauralP95Ms, 2)} ms`);
    if (state.mode === 'error') {
      const reason = status?.reason ?? 'OpenJOC 未返回更具体的失败原因。';
      setLiveText('error-human-reason', humanErrorReason(reason));
      setLiveText('error-code', errorCode(reason, status?.metrics.stage ?? null));
      setLiveText('error-reason', reason);
      setLiveText('error-stage', status?.metrics.stage ?? 'unknown');
    }
    const rawElement = panelBody.querySelector<HTMLElement>('.raw-json');
    if (rawElement !== null) rawElement.textContent = diagnosticsJson(state, status);
  }

  function setLiveText(key: string, value: string): HTMLElement | null {
    const element = panelBody.querySelector<HTMLElement>(`[data-live="${key}"]`);
    if (element !== null) element.textContent = value;
    return element;
  }

  function handleClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const actionElement = target.closest<HTMLElement>('[data-action]');
    const action = actionElement?.dataset.action;
    if (action === undefined) return;
    switch (action) {
      case 'enable':
        transition({type: 'enable'});
        callbacks.onEnable({renderer: state.renderer, dialnorm: state.dialnorm});
        return;
      case 'disable':
        transition({type: 'disable'});
        callbacks.onDisable();
        return;
      case 'toggle-always-enabled': {
        const enabled = !state.alwaysEnabled;
        transition({type: 'set-always-enabled', enabled});
        callbacks.onAlwaysEnabledChange(enabled);
        return;
      }
      case 'reset-gain':
        changeGain(0, null, true);
        return;
      case 'collapse':
        transition({type: 'collapse'});
        return;
      case 'expand':
        transition({type: 'expand'});
        return;
      case 'open-diagnostics':
        transition({type: 'open-diagnostics'});
        return;
      case 'close-diagnostics':
        transition({type: 'close-diagnostics'});
        return;
      case 'open-raw':
        transition({type: 'open-raw'});
        return;
      case 'copy-json':
        void copyDiagnosticsJson();
        return;
      case 'toggle-error-details':
        transition({type: 'toggle-error-details'});
        return;
      case 'return-native':
        transition({type: 'return-native'});
        callbacks.onReturnNative();
        return;
      case 'close-error':
        transition({type: 'close-error'});
        return;
      case 'dismiss-detection':
        transition({type: 'dismiss-detection'});
        return;
      case 'close-nonjoc':
        transition({type: 'close-nonjoc'});
        return;
    }
  }

  function handleChange(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.field === 'output-gain') {
      if (Number.isFinite(target.valueAsNumber)) changeGain(target.valueAsNumber, null);
      else updateGainControls(null);
      return;
    }
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.dataset.field === 'dialnorm') {
      const mode: DialnormMode = target.value === 'unity' ? 'unity' : 'calibrated';
      transition({type: 'set-dialnorm', mode});
      callbacks.onDialnormChange(mode);
      return;
    }
    if (target.dataset.field === 'renderer') {
      const renderer = target.value === 'binaural-headphones' ? 'binaural-headphones' : 'stereo-speakers';
      transition({type: 'set-renderer', renderer});
      callbacks.onRendererChange(renderer);
    }
  }

  function handleInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.field !== 'output-gain' || !Number.isFinite(target.valueAsNumber)) return;
    changeGain(target.valueAsNumber, target);
  }

  function changeGain(value: number, source: HTMLInputElement | null, isReset = false): void {
    const gainDb = normalizeOutputGainDb(value);
    const changed = gainDb !== state.gainDb;
    state = advanceOverlayState(state, {type: 'set-gain', gainDb});
    // Keep the range element alive while dragging; live telemetry must not rebuild it.
    updateGainControls(source);
    if (changed || isReset) callbacks.onGainChange(gainDb);
  }

  function updateGainControls(source: HTMLInputElement | null): void {
    for (const input of panelBody.querySelectorAll<HTMLInputElement>('input[data-field="output-gain"]')) {
      if (input !== source) input.value = state.gainDb.toFixed(1);
      if (input.type === 'range') {
        input.setAttribute('aria-valuetext', gainLabel(state.gainDb));
        input.style.setProperty('--gain-progress', `${gainProgress(state.gainDb)}%`);
      }
    }
    const raw = panelBody.querySelector<HTMLElement>('.raw-json');
    if (raw !== null) raw.textContent = diagnosticsJson(state, status);
  }

  async function copyDiagnosticsJson(): Promise<void> {
    const content = diagnosticsJson(state, status);
    try {
      if (navigator.clipboard?.writeText !== undefined) {
        await navigator.clipboard.writeText(content);
      } else {
        const input = document.createElement('textarea');
        input.value = content;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.append(input);
        try {
          input.select();
          if (!document.execCommand('copy')) throw new Error('clipboard copy was rejected');
        } finally {
          input.remove();
        }
      }
      showCopyStatus('已复制');
    } catch {
      showCopyStatus('复制失败，请手动选择');
    }
  }

  function showCopyStatus(message: string): void {
    const label = panelBody.querySelector<HTMLElement>('[data-copy-status]');
    if (label === null) return;
    label.textContent = message;
    if (copyStatusTimer !== null) window.clearTimeout(copyStatusTimer);
    copyStatusTimer = window.setTimeout((): void => {
      const current = panelBody.querySelector<HTMLElement>('[data-copy-status]');
      if (current !== null) current.textContent = '';
      copyStatusTimer = null;
    }, 1_800);
  }

  panelBody.addEventListener('click', handleClick);
  panelBody.addEventListener('change', handleChange);
  panelBody.addEventListener('input', handleInput);
  render();

  return {
    setManifest(hasJoc: boolean): void {
      transition({type: 'manifest', hasJoc});
    },
    setAlwaysEnabled(enabled: boolean): void {
      if (state.alwaysEnabled === enabled) return;
      transition({type: 'set-always-enabled', enabled});
    },
    setDialnorm(mode: DialnormMode): void {
      if (state.dialnorm === mode) return;
      transition({type: 'set-dialnorm', mode});
    },
    setRenderer(renderer: OverlayRenderer): void {
      if (state.renderer === renderer) return;
      transition({type: 'set-renderer', renderer});
    },
    setGainDb(gainDb: number): void {
      if (state.gainDb === gainDb) return;
      transition({type: 'set-gain', gainDb});
    },
    setDebugSummary(summary: string): void {
      panel.dataset.debug = summary;
    },
    setRequested(nextIsRequested: boolean): void {
      if (!nextIsRequested && state.mode !== 'error') {
        if (state.mode === 'active' || state.mode === 'collapsed' || state.mode === 'diagnostics' || state.mode === 'raw') transition({type: 'disable'});
        else render();
        return;
      }
      if (nextIsRequested && state.hasJoc && state.mode === 'detected') {
        state = advanceOverlayState(state, {type: 'enable'});
      }
      render();
    },
    setStatus(nextStatus: OverlayStatus | null): void {
      const shouldRebuild = nextStatus !== null && needsOverlayMarkupRebuild(state.mode, nextStatus.phase);
      status = nextStatus;
      if (shouldRebuild) {
        transition({type: 'error'});
        return;
      }
      updateLiveStatus();
    },
    toggleManually(): void {
      transition({type: 'manual-open'});
    },
    reset(): void {
      status = null;
      state = resetOverlayState(state);
      render();
    },
  };
}

function renderMode(state: OverlayState, status: OverlayStatus | null): string {
  switch (state.mode) {
    case 'detected':
      return renderDetected();
    case 'collapsed':
      return renderCollapsed(state);
    case 'diagnostics':
      return renderExpanded(state, status, true, false);
    case 'raw':
      return renderExpanded(state, status, true, true);
    case 'error':
      return renderError(status, state.errorDetailsOpen);
    case 'nonjoc':
      return renderNonJoc();
    case 'active':
      return renderExpanded(state, status, false, false);
    case 'hidden':
      return '';
  }
}

function renderDetected(): string {
  return `<section class="shell detected-panel" data-state="detected">
    <div class="detected-grid">
      <span class="status-dot checking" aria-hidden="true"></span>
      <div class="detected-copy"><h2>JOC 音频已检测</h2><p>当前视频包含 E-AC-3 JOC 流。</p></div>
      <div class="detected-actions">
        <button class="icon-button detected-close" type="button" aria-label="关闭检测提示" data-action="dismiss-detection">${icon('close')}</button>
        <button class="primary-button" type="button" data-action="enable">启用</button>
      </div>
    </div>
  </section>`;
}


function renderCollapsed(state: OverlayState): string {
  return `<section class="shell collapsed-panel" data-state="collapsed">
    <span class="status-dot active" aria-hidden="true"></span>
    <div class="collapsed-copy"><strong>OpenJOC</strong><span>JOC ${'\u00b7'} ${overlayRendererLabel(state.renderer)}</span></div>
    <button class="icon-button" type="button" aria-label="OpenJOC panel" data-action="expand">${icon('expand')}</button>
  </section>`;
}

function renderExpanded(state: OverlayState, status: OverlayStatus | null, includeDiagnostics: boolean, includeRaw: boolean): string {
  const statusLabel = includeDiagnostics ? '已启用 · 高级信息' : playbackStatusLabel(status);
  return `<section class="shell expanded-panel" data-state="${includeDiagnostics ? 'diagnostics' : 'active'}">
    <header class="panel-header">
      <div class="brandline"><span class="status-dot active" aria-hidden="true"></span><div class="status-stack"><strong>OpenJOC</strong><span data-live="status-label">${escapeHtml(statusLabel)}</span></div></div>
      <button class="icon-button" type="button" aria-label="折叠 OpenJOC 控制器" data-action="collapse">${icon('collapse')}</button>
    </header>
    ${renderNormalBody(state, status, includeDiagnostics, includeRaw)}
  </section>`;
}

function renderNormalBody(state: OverlayState, status: OverlayStatus | null, includeDiagnostics: boolean, includeRaw: boolean): string {
  const rendererOptions = OVERLAY_RENDERER_OPTIONS.map((option) => `<option value="${option.renderer}"${option.renderer === state.renderer ? ' selected' : ''}${option.enabled ? '' : ' disabled'}>${escapeHtml(option.label)}</option>`).join('');
  const metrics = status?.metrics ?? null;
  const raw = includeRaw ? `<div class="raw-panel"><div class="raw-heading"><strong>原始诊断 JSON</strong><button class="text-button" type="button" data-action="copy-json">复制 JSON</button></div><pre class="raw-json">${escapeHtml(diagnosticsJson(state, status))}</pre></div>` : `<button class="secondary-trigger" type="button" data-action="open-raw" aria-expanded="false"><span>原始诊断 JSON</span><span class="trigger-chevron">›</span></button>`;
  return `<div class="format-block"><p class="eyebrow">当前音频</p><h2 class="format-name">E-AC-3 JOC</h2><label class="field-label" for="openjoc-renderer">输出方式</label><select id="openjoc-renderer" class="select" data-field="renderer" aria-label="选择输出方式">${rendererOptions}</select></div>
    <div class="field-block"><label class="field-label" for="openjoc-dialnorm">节目电平</label><select id="openjoc-dialnorm" class="select" data-field="dialnorm" aria-describedby="openjoc-dialnorm-help"><option value="calibrated"${state.dialnorm === 'calibrated' ? ' selected' : ''}>校准（推荐）</option><option value="unity"${state.dialnorm === 'unity' ? ' selected' : ''}>Unity / 兼容模式</option></select><p class="field-help" id="openjoc-dialnorm-help">${state.dialnorm === 'unity' ? '关闭 Dialnorm 衰减，优先保证兼容性。' : '遵循节目 Dialnorm 元数据。'}</p></div>
    ${renderHealth(metrics)}
    ${includeDiagnostics ? renderDiagnostics(state, status, raw) : `<div class="actions-block"><button class="primary-button action-button" type="button" data-action="disable">停用 OpenJOC</button><button class="secondary-trigger" type="button" data-action="open-diagnostics" aria-expanded="false"><span>高级 <small>技术信息</small></span><span class="trigger-chevron">›</span></button><span class="copy-status" data-copy-status aria-live="polite"></span></div>`}`;
}

type HealthValues = Readonly<{
  readonly driftLabel: string;
  readonly loudnessLabel: string;
  readonly driftClass: string;
}>;

function healthValues(metrics: PlaybackMetrics | null): HealthValues {
  const drift = metrics?.driftMs ?? null;
  const averageDb = metrics?.averageDb ?? null;
  return {
    driftLabel: drift === null ? '等待数据' : `${drift >= 0 ? '+' : ''}${formatNumber(drift, 0)} ms`,
    loudnessLabel: averageDb === null ? '等待数据' : `${formatNumber(averageDb, 1)} dB`,
    driftClass: drift === null ? '' : Math.abs(drift) <= 80 ? 'good' : 'warn',
  };
}

function renderHealth(metrics: PlaybackMetrics | null): string {
  const health = healthValues(metrics);
  return `<div class="health-block" aria-label="播放健康"><div class="metric-row"><span>音画同步</span><strong class="metric-value${health.driftClass === '' ? '' : ` ${health.driftClass}`}" data-live="health-sync">${escapeHtml(health.driftLabel)}</strong></div><div class="metric-row"><span>平均响度</span><strong class="metric-value" data-live="health-loudness">${escapeHtml(health.loudnessLabel)}</strong></div></div>`;
}

function renderDiagnostics(state: OverlayState, status: OverlayStatus | null, raw: string): string {
  const metrics = status?.metrics ?? null;
  binauralDiagnosticsMarkup = state.renderer === 'binaural-headphones' ? renderBinauralDiagnostics(metrics) : '';
  alwaysEnabledMarkup = renderAlwaysEnabledControl(state);
  return `<div class="diagnostics-section"><div class="diagnostics-heading"><h3>高级诊断</h3><span>实时快照</span></div>
    ${renderGainControl(state)}
    ${renderDiagGroup('Decoder', [{label: '解码器', value: 'OpenJOC WASM', liveKey: null}])}
    ${renderDiagGroup('Input', [{label: '输入', value: 'E-AC-3 JOC', liveKey: null}, {label: '状态', value: playbackStatusLabel(status), liveKey: 'diag-status'}])}
    ${renderDiagGroup('Profile', [{label: '配置', value: status?.profile ?? '等待 JOC 配置', liveKey: 'diag-profile'}, {label: '阶段', value: status?.metrics.stage ?? '—', liveKey: 'diag-stage'}])}
    ${renderDiagGroup('Audio', [{label: '采样率', value: `${OVERLAY_SAMPLE_RATE} Hz`, liveKey: null}, {label: '输出声道', value: '2', liveKey: null}, {label: '渲染器', value: rendererLabel(state.renderer), liveKey: null}])}
    ${renderDiagGroup('Realtime', [{label: '音画偏移', value: metrics?.driftMs === null || metrics === null ? '—' : formatNumber(metrics.driftMs, 1) + ' ms', liveKey: 'diag-drift'}, {label: '平均响度', value: metrics?.averageDb === null || metrics === null ? '—' : formatNumber(metrics.averageDb, 1) + ' dB', liveKey: 'diag-loudness'}, {label: '缓冲', value: metrics === null ? '—' : formatDuration(metrics.pcmBufferMs), liveKey: 'diag-buffer'}, {label: '欠载', value: metrics === null ? '—' : formatInteger(metrics.underrunCount), liveKey: 'diag-underruns'}, {label: '解码 p95', value: metrics === null ? '—' : formatNumber(metrics.decodeP95Ms, 1) + ' ms', liveKey: 'diag-decode-p95'}, {label: '实时因子', value: metrics?.realtimeFactor === null || metrics === null ? '—' : formatNumber(metrics.realtimeFactor, 2) + '×', liveKey: 'diag-realtime'}])}
    ${renderDiagGroup('Memory', [{label: 'WASM 当前', value: metrics === null ? '—' : formatBytes(metrics.peakWasmMemoryBytes), liveKey: 'diag-memory'}, {label: 'WASM 峰值', value: metrics === null ? '—' : formatBytes(metrics.peakWasmMemoryBytes), liveKey: 'diag-memory-peak'}])}
    <div class="diagnostics-actions">${raw}<button class="secondary-trigger" type="button" data-action="close-diagnostics" aria-expanded="true"><span>收起高级诊断</span><span class="trigger-chevron up">›</span></button><span class="copy-status" data-copy-status aria-live="polite"></span></div>`;
}

function renderBinauralDiagnostics(metrics: PlaybackMetrics | null): string {
  return renderDiagGroup('Binaural', [
    {label: 'Virtual Layout', value: metrics?.virtualLayout ?? '7.1.4 (Default)', liveKey: null},
    {label: 'HRTF', value: metrics?.hrtf === null || metrics === null ? 'Built-in SADIE II D1 (Default)' : `${metrics.hrtf} (Default)`, liveKey: null},
    {label: 'Binaural latency', value: metrics?.binauralLatencyMs === null || metrics === null ? '—' : `${formatNumber(metrics.binauralLatencyMs, 2)} ms`, liveKey: 'diag-binaural-latency'},
    {label: 'Binaural p95', value: metrics?.binauralP95Ms === null || metrics === null ? '—' : `${formatNumber(metrics.binauralP95Ms, 2)} ms`, liveKey: 'diag-binaural-p95'},
  ]);
}

function renderAlwaysEnabledControl(state: OverlayState): string {
  const label = '\u59cb\u7ec8\u542f\u7528 OpenJOC';
  return `<button class="advanced-toggle" type="button" role="switch" aria-checked="${state.alwaysEnabled}" aria-label="${label}" data-action="toggle-always-enabled"><span class="advanced-toggle-label">${label}</span><span class="advanced-toggle-track" aria-hidden="true"><span class="advanced-toggle-thumb"></span></span></button>`;
}

function gainLabel(gainDb: number): string {
  return `${gainDb > 0 ? '+' : ''}${gainDb.toFixed(1)} dB`;
}

function gainProgress(gainDb: number): number {
  return (gainDb - OUTPUT_GAIN_MIN_DB) * 100 / (OUTPUT_GAIN_MAX_DB - OUTPUT_GAIN_MIN_DB);
}

function renderGainControl(state: OverlayState): string {
  return `<section class="gain-setting" aria-label="自定义增益">
    <div class="gain-heading"><label for="openjoc-output-gain-range">自定义增益</label><div class="gain-value-control"><input id="openjoc-output-gain-value" class="gain-number" type="number" min="${OUTPUT_GAIN_MIN_DB}" max="${OUTPUT_GAIN_MAX_DB}" step="${OUTPUT_GAIN_STEP_DB}" value="${state.gainDb.toFixed(1)}" data-field="output-gain" aria-label="自定义增益数值" aria-describedby="openjoc-output-gain-help"><span>dB</span><button class="text-button gain-reset" type="button" data-action="reset-gain">重置</button></div></div>
    <input id="openjoc-output-gain-range" class="gain-range" type="range" min="${OUTPUT_GAIN_MIN_DB}" max="${OUTPUT_GAIN_MAX_DB}" step="${OUTPUT_GAIN_STEP_DB}" value="${state.gainDb}" data-field="output-gain" aria-valuetext="${gainLabel(state.gainDb)}" aria-describedby="openjoc-output-gain-help" style="--gain-progress:${gainProgress(state.gainDb)}%">
    <div class="gain-limits" aria-hidden="true"><span>−20 dB</span><span>+20 dB</span></div>
    <p class="field-help" id="openjoc-output-gain-help">0 dB 保持原音量，提升过高可能失真。</p>
  </section>`;
}

type DiagnosticRow = Readonly<{
  readonly label: string;
  readonly value: string;
  readonly liveKey: string | null;
}>;

function renderDiagGroup(title: string, rows: ReadonlyArray<DiagnosticRow>): string {
  const group = `<section class="diag-group"><h4>${escapeHtml(title)}</h4>${rows.map((row) => `<div class="diag-row"><span>${escapeHtml(row.label)}</span><strong${row.liveKey === null ? '' : ` data-live="${row.liveKey}"`}>${escapeHtml(row.value)}</strong></div>`).join('')}</section>`;
  return title === 'Audio' ? `${group}${binauralDiagnosticsMarkup}${alwaysEnabledMarkup}` : group;
}

function renderError(status: OverlayStatus | null, detailsOpen: boolean): string {
  const reason = status?.reason ?? 'OpenJOC 未返回更具体的失败原因。';
  const humanReason = humanErrorReason(reason);
  const code = errorCode(reason, status?.metrics.stage ?? null);
  const details = detailsOpen ? `<div class="error-details"><div><span>底层原因</span><strong data-live="error-reason">${escapeHtml(reason)}</strong></div><div><span>失败阶段</span><strong data-live="error-stage">${escapeHtml(status?.metrics.stage ?? 'unknown')}</strong></div><div><span>原生 Dolby 解码器</span><strong>未使用</strong></div></div>` : '';
  return `<section class="shell error-panel" data-state="error"><header class="panel-header"><div class="brandline"><span class="status-dot error" aria-hidden="true"></span><div class="status-stack"><strong>OpenJOC</strong><span>播放失败</span></div></div><button class="icon-button" type="button" aria-label="关闭错误面板" data-action="close-error">${icon('close')}</button></header><div class="error-body"><p class="eyebrow">无法继续播放</p><h2>无法解码 JOC 音频</h2><div class="error-reason"><span>原因</span><p data-live="error-human-reason">${escapeHtml(humanReason)}</p></div><div class="error-code"><span>错误代码</span><strong data-live="error-code">${escapeHtml(code)}</strong></div><p class="error-hint">请尝试刷新页面后再试。</p><div class="error-actions"><button class="primary-button action-button" type="button" data-action="return-native">返回原生音频</button><button class="secondary-trigger" type="button" data-action="toggle-error-details" aria-expanded="${detailsOpen}"><span>详情</span><span class="trigger-chevron${detailsOpen ? ' open' : ''}">›</span></button>${details}</div></div></section>`;
}

function renderNonJoc(): string {
  return `<section class="shell nonjoc-panel" data-state="nonjoc"><div class="panel-header compact-header"><div class="brandline"><span class="status-dot inactive" aria-hidden="true"></span><div class="status-stack"><strong>OpenJOC</strong><span>页面音频状态</span></div></div><button class="icon-button" type="button" aria-label="关闭提示" data-action="close-nonjoc">${icon('close')}</button></div><div class="nonjoc-body"><h2>未检测到 JOC 音频</h2><p>当前页面保持原生音频输出。</p></div></section>`;
}

function playbackStatusLabel(status: OverlayStatus | null): string {
  switch (status?.phase) {
    case 'preparing': return '准备中';
    case 'ready': return '已启用 · 等待音频';
    case 'paused': return '已启用 · 已暂停';
    case 'buffering': return '已启用 · 缓冲中';
    case 'active': return '已启用';
    default: return '已启用';
  }
}

function rendererLabel(renderer: OverlayRenderer): string {
  return OVERLAY_RENDERER_OPTIONS.find((option) => option.renderer === renderer)?.label ?? '立体声（扬声器）';
}

function humanErrorReason(reason: string): string {
  const normalized = reason.toLowerCase();
  if (normalized.includes('playback rate')) return '当前播放速度不是 1.0x，OpenJOC 暂不支持该播放速度。';
  if (normalized.includes('profile')) return '检测到 JOC 流，但当前流没有提供可用的 JOC 配置。';
  if (normalized.includes('segment') || normalized.includes('media') || normalized.includes('cmaf')) return '检测到 JOC 流，但音频分片无法完整获取。';
  return '检测到 JOC 流，但 OpenJOC 无法完成当前音频的解码。';
}

function errorCode(reason: string, stage: string | null): string {
  const normalized = `${reason} ${stage ?? ''}`.toLowerCase();
  if (normalized.includes('playback rate')) return 'JOC-RATE-UNSUPPORTED';
  if (normalized.includes('profile')) return 'JOC-PROFILE-INVALID';
  if (normalized.includes('segment') || normalized.includes('media') || normalized.includes('cmaf')) return 'JOC-MEDIA-UNAVAILABLE';
  return 'JOC-DECODE-FAILED';
}

function diagnosticsJson(state: OverlayState, status: OverlayStatus | null): string {
  const metrics = status?.metrics ?? null;
  const renderer = metrics?.renderer ?? (state.renderer === 'binaural-headphones' ? 'binaural' : 'stereo');
  const isBinaural = renderer === 'binaural';
  return JSON.stringify({
    decoder: 'openjoc-wasm',
    input: 'eac3-joc',
    phase: status?.phase ?? 'disabled',
    profile: status?.profile ?? null,
    renderer,
    dialnorm: state.dialnorm,
    outputGainDb: state.gainDb,
    alwaysEnabled: state.alwaysEnabled,
    sampleRate: OVERLAY_SAMPLE_RATE,
    outputChannels: 2,
    driftMs: metrics?.driftMs ?? null,
    averageDb: metrics?.averageDb ?? null,
    bufferMs: metrics?.pcmBufferMs ?? null,
    underruns: metrics?.underrunCount ?? null,
    decodeP95Ms: metrics?.decodeP95Ms ?? null,
    realtimeFactor: metrics?.realtimeFactor ?? null,
    virtualLayout: metrics?.virtualLayout ?? (isBinaural ? '7.1.4' : null),
    hrtf: metrics?.hrtf ?? (isBinaural ? 'Built-in SADIE II D1' : null),
    binauralLatencyMs: metrics?.binauralLatencyMs ?? null,
    binauralP95Ms: metrics?.binauralP95Ms ?? null,
    wasmMemoryBytes: metrics?.peakWasmMemoryBytes ?? null,
    reason: status?.reason ?? null,
  }, null, 2);
}

function formatNumber(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function formatInteger(value: number): string {
  return Number.isSafeInteger(value) ? String(value) : '—';
}

function formatDuration(valueMs: number): string {
  if (!Number.isFinite(valueMs) || valueMs < 0) return '—';
  return valueMs >= 1_000 ? `${formatNumber(valueMs / 1_000, 1)} s` : `${formatNumber(valueMs, 0)} ms`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  return value >= 1024 * 1024 ? `${formatNumber(value / (1024 * 1024), 1)} MiB` : `${formatNumber(value / 1024, 0)} KiB`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function icon(name: 'close' | 'collapse' | 'expand'): string {
  if (name === 'close') return '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  if (name === 'collapse') return '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 10h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  return '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m7 4 6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

const OVERLAY_STYLE = `
:host { all: initial; }
:host([hidden]) { display: none !important; }
*, *::before, *::after { box-sizing: border-box; }
.panel { position: fixed; right: clamp(12px, 2vw, 20px); bottom: clamp(12px, 2vw, 20px); z-index: 2147483647; width: min(360px, calc(100vw - 24px)); max-width: calc(100% - 24px); max-height: min(680px, calc(100vh - 24px)); color: #1d1d1f; background: rgba(255,255,255,.97); border: 1px solid #d2d2d7; border-radius: 16px; box-shadow: 0 18px 42px rgba(0,0,0,.25); overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
.panel.detected { width: min(380px, calc(100vw - 24px)); }
button, select, input { font: inherit; }
button { cursor: pointer; }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 3px solid rgba(0,113,227,.3); outline-offset: 2px; }
.shell { min-width: 0; }
.status-dot { width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%; background: #86868b; box-shadow: 0 0 0 4px rgba(134,134,139,.15); }
.status-dot.active { background: #16a34a; box-shadow: 0 0 0 4px rgba(22,163,74,.15); }
.status-dot.checking { background: #eab308; box-shadow: 0 0 0 4px rgba(234,179,8,.18); }
.status-dot.error { background: #dc2626; box-shadow: 0 0 0 4px rgba(220,38,38,.15); }
.status-dot.inactive { background: #86868b; }
.detected-grid { position: relative; min-height: 82px; padding: 20px 8px 14px 16px; display: grid; grid-template-columns: 10px minmax(0, 1fr) 120px; align-items: center; gap: 10px; }
.detected-copy { min-width: 0; }
.detected-copy h2, .error-body h2, .nonjoc-body h2 { margin: 0; font-size: 19px; font-weight: 650; letter-spacing: -.02em; line-height: 1.1; }
.detected-copy p, .nonjoc-body p { margin: 6px 0 0; color: #6e6e73; font-size: 13px; line-height: 1.35; }
.detected-actions { position: relative; min-width: 120px; padding-right: 38px; display: flex; align-items: center; justify-content: flex-start; }
.detected-close { position: absolute; top: 0; right: 0; z-index: 1; color: #1d1d1f; background: #e8ecf2; border-color: #9aa3b2; }
.detected-close svg { display: none; }
.detected-close::before { content: "×"; font-size: 18px; line-height: 1; }
.icon-button { width: 34px; height: 34px; padding: 0; display: grid; place-items: center; color: #424245; background: transparent; border: 1px solid transparent; border-radius: 50%; }
.icon-button:hover { background: #f5f5f7; border-color: #d2d2d7; }
.icon-button svg { width: 16px; height: 16px; }
.primary-button { min-height: 42px; min-width: 76px; padding: 8px 14px; display: inline-flex; align-items: center; justify-content: center; color: white; background: #0071e3; border: 1px solid #0071e3; border-radius: 9px; font-size: 14px; font-weight: 650; line-height: 1.1; white-space: nowrap; }
.primary-button:hover { background: #0077ed; border-color: #0077ed; }
.primary-button:active { background: #0066cc; border-color: #0066cc; transform: scale(.98); }
.panel-header { min-height: 62px; padding: 13px 14px 13px 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid #e8e8ed; }
.compact-header { border-bottom: 0; padding-bottom: 2px; }
.brandline { min-width: 0; display: flex; align-items: center; gap: 10px; }
.status-stack { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.status-stack strong { font-size: 17px; font-weight: 650; line-height: 1.1; }
.status-stack span { color: #6e6e73; font-size: 12px; line-height: 1.2; }
.format-block { padding: 17px 16px 15px; }
.eyebrow { margin: 0; color: #86868b; font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .07em; text-transform: uppercase; }
.format-name { margin: 5px 0 15px; font-size: 23px; font-weight: 650; letter-spacing: -.025em; line-height: 1.1; }
.field-label { display: block; margin: 0 0 7px; color: #424245; font-size: 14px; font-weight: 650; }
.select { width: 100%; min-height: 42px; padding: 0 32px 0 12px; color: #1d1d1f; background: white; border: 1px solid #d2d2d7; border-radius: 9px; }
.select:hover { border-color: #86868b; }
.select option:disabled { color: #86868b; }
.field-block { padding: 14px 16px; border-top: 1px solid #e8e8ed; }
.field-help { margin: 7px 0 0; color: #6e6e73; font-size: 12px; line-height: 1.35; }
.health-block { padding: 5px 16px 8px; border-top: 1px solid #e8e8ed; }
.metric-row { min-height: 34px; display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 12px; color: #6e6e73; font-size: 14px; }
.metric-value { color: #424245; font: 13px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; }
.metric-value.good { color: #15803d; }
.metric-value.warn { color: #b45309; }
.actions-block, .diagnostics-actions, .error-actions { padding: 14px 16px 16px; display: grid; gap: 8px; border-top: 1px solid #e8e8ed; }
.action-button { width: 100%; }
.secondary-trigger { width: 100%; min-height: 30px; padding: 5px 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #424245; background: transparent; border: 0; font-size: 13px; text-align: left; }
.secondary-trigger:hover { color: #0071e3; }
.secondary-trigger small { color: #86868b; font-size: 11px; font-weight: 400; }
.trigger-chevron { color: #86868b; font-size: 20px; line-height: 1; }
.trigger-chevron.up { transform: rotate(-90deg); }
.trigger-chevron.open { transform: rotate(90deg); }
.copy-status { min-height: 16px; color: #15803d; font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-align: center; }
.copy-status:empty { display: none; }
.collapsed-panel { min-height: 50px; padding: 0 8px 0 14px; display: grid; grid-template-columns: 9px minmax(0,1fr) auto; align-items: center; gap: 10px; }
.collapsed-copy { min-width: 0; display: flex; align-items: baseline; gap: 8px; }
.collapsed-copy strong { font-size: 14px; font-weight: 650; white-space: nowrap; }
.collapsed-copy span { color: #6e6e73; font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; }
.diagnostics-section { border-top: 1px solid #e8e8ed; }
.diagnostics-heading { padding: 16px 16px 9px; display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.diagnostics-heading h3 { margin: 0; font-size: 16px; font-weight: 650; }
.diagnostics-heading span { color: #86868b; font-size: 11px; }
.gain-setting { padding: 12px 16px 14px; border-top: 1px solid #f0f0f3; }
.gain-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.gain-heading > label { font-size: 13px; font-weight: 600; }
.gain-value-control { display: flex; align-items: center; gap: 6px; color: #6e6e73; font-size: 12px; }
.gain-number { width: 61px; min-height: 30px; padding: 4px 6px; border: 1px solid #d2d2d7; border-radius: 7px; background: #fff; color: #1d1d1f; text-align: right; font-variant-numeric: tabular-nums; appearance: textfield; }
.gain-number::-webkit-inner-spin-button, .gain-number::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.gain-reset { margin-left: 4px; padding: 5px 0; }
.gain-range { display: block; appearance: none; -webkit-appearance: none; width: 100%; height: 26px; margin: 10px 0 0; padding: 0; background: transparent; cursor: pointer; accent-color: #0071e3; }
.gain-range::-webkit-slider-runnable-track { height: 4px; border-radius: 999px; background: linear-gradient(to right, #0071e3 var(--gain-progress), #dedee3 var(--gain-progress)); }
.gain-range::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; margin-top: -8px; border: 1px solid rgba(0,0,0,.12); border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.22); }
.gain-range::-moz-range-track { height: 4px; border-radius: 999px; background: #dedee3; }
.gain-range::-moz-range-progress { height: 4px; border-radius: 999px; background: #0071e3; }
.gain-range::-moz-range-thumb { width: 18px; height: 18px; border: 1px solid rgba(0,0,0,.12); border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.22); }
.gain-limits { display: flex; justify-content: space-between; color: #86868b; font-size: 11px; font-variant-numeric: tabular-nums; }
.diag-group { padding: 8px 16px; border-top: 1px solid #f0f0f3; }
.diag-group h4 { margin: 0 0 4px; color: #86868b; font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .06em; text-transform: uppercase; }
.diag-row { min-height: 27px; display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.3fr); align-items: center; gap: 10px; color: #6e6e73; font-size: 12px; }
.diag-row strong { min-width: 0; color: #424245; font: 12px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-align: right; overflow-wrap: anywhere; }
.advanced-toggle { position: relative; width: 100%; min-height: 34px; padding: 7px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #1d1d1f; background: transparent; border: 0; font-size: 13px; line-height: 1.25; text-align: left; cursor: pointer; user-select: none; }
.advanced-toggle-label, .advanced-toggle-track { pointer-events: none; }
.advanced-toggle-track { position: relative; width: 38px; height: 22px; flex: 0 0 auto; border: 1px solid rgba(0,0,0,.12); border-radius: 999px; background: #d2d2d7; box-shadow: inset 0 1px 2px rgba(0,0,0,.08); transition: background-color .18s ease, border-color .18s ease, box-shadow .18s ease; }
.advanced-toggle-thumb { position: absolute; top: 1px; left: 1px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.28); transition: transform .18s cubic-bezier(.2,.8,.2,1); }
.advanced-toggle[aria-checked="true"] .advanced-toggle-track { border-color: #34c759; background: #34c759; box-shadow: inset 0 0 0 1px rgba(0,0,0,.03); }
.advanced-toggle[aria-checked="true"] .advanced-toggle-thumb { transform: translateX(16px); }
.advanced-toggle:hover .advanced-toggle-track { border-color: rgba(0,0,0,.2); }
.advanced-toggle:hover[aria-checked="true"] .advanced-toggle-track { border-color: #30b653; background: #30b653; }
.advanced-toggle:focus-visible { outline: 3px solid rgba(0,113,227,.3); outline-offset: 3px; border-radius: 8px; }
.advanced-toggle-label { padding-top: 1px; }
.advanced-toggle:focus-visible .advanced-toggle-label { color: #0071e3; }
@media (prefers-reduced-motion: reduce) { .advanced-toggle-track, .advanced-toggle-thumb { transition: none; } }
.raw-panel { padding: 9px; background: #f5f5f7; border: 1px solid #e8e8ed; border-radius: 9px; }
.raw-heading { min-height: 26px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.raw-heading strong { font-size: 12px; }
.text-button { padding: 3px 0; color: #0071e3; background: transparent; border: 0; font-size: 12px; font-weight: 650; white-space: nowrap; }
.raw-json { max-height: 190px; overflow: auto; margin: 7px 0 0; padding: 10px; color: #424245; background: white; border: 1px solid #e8e8ed; border-radius: 7px; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.error-body { padding: 17px 16px 15px; }
.error-body h2 { margin-top: 6px; }
.error-reason { margin-top: 15px; padding: 11px 12px; background: rgba(220,38,38,.06); border: 1px solid rgba(220,38,38,.2); border-radius: 9px; }
.error-reason span, .error-details span { display: block; color: #6e6e73; font-size: 11px; font-weight: 650; }
.error-reason p { margin: 4px 0 0; color: #424245; font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
.error-code { margin-top: 8px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: rgba(220,38,38,.06); border: 1px solid rgba(220,38,38,.2); border-radius: 9px; }
.error-code span { color: #6e6e73; font-size: 12px; }
.error-code strong { color: #dc2626; font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; }
.error-hint { margin: 10px 0 0; color: #6e6e73; font-size: 12px; line-height: 1.35; }
.error-actions { margin: 16px -16px -15px; border-top: 1px solid #e8e8ed; }
.error-details { max-height: 150px; overflow: auto; padding: 10px 12px; display: grid; gap: 9px; background: #f5f5f7; border: 1px solid #e8e8ed; border-radius: 9px; }
.error-details strong { display: block; margin-top: 2px; color: #424245; font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.nonjoc-body { padding: 6px 16px 18px; }
@media (max-width: 420px) { .panel { right: 12px; bottom: 12px; width: calc(100vw - 24px); } .detected-grid { grid-template-columns: 9px minmax(0,1fr) 110px; gap: 8px; padding-left: 13px; } .detected-actions { min-width: 110px; padding-right: 34px; } .primary-button { min-width: 72px; padding-inline: 10px; } .collapsed-copy { gap: 6px; } }
`;
