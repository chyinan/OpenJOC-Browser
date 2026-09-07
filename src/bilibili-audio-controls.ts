// pattern: Imperative Shell

// MAIN world: change only the selected element, never HTMLMediaElement.prototype.
((): void => {
  const origin = 'https://www.bilibili.com';
  const nativeMuted = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
  type Owner = Readonly<{token: string; requestId: string; generation: number}>;
  type Control = {video: HTMLVideoElement; owner: Owner; muted: boolean; onVolume: () => void};
  let control: Control | null = null;

  function publish(current: Control): void {
    if (control !== current) return;
    if (nativeMuted?.get?.call(current.video) !== true) nativeMuted?.set?.call(current.video, true);
    window.postMessage({source: 'openjoc-audio', type: 'audio-state', ...current.owner,
      volume: current.video.volume, muted: current.muted, suppressed: nativeMuted?.get?.call(current.video) === true}, origin);
  }

  function release(): void {
    const previous = control;
    if (previous === null) return;
    control = null;
    previous.video.removeEventListener('volumechange', previous.onVolume);
    // Removing our own accessor restores the browser's original property behavior.
    Reflect.deleteProperty(previous.video, 'muted');
    nativeMuted?.set?.call(previous.video, previous.muted);
  }

  window.addEventListener('message', (event: MessageEvent<unknown>): void => {
    if (event.source !== window || event.origin !== origin || typeof event.data !== 'object' || event.data === null) return;
    const message = event.data as Record<string, unknown>;
    if (message.source !== 'openjoc-content' || (message.type !== 'take-audio-control' && message.type !== 'release-audio-control')
      || typeof message.token !== 'string' || message.token.length === 0 || typeof message.requestId !== 'string' || message.requestId.length === 0
      || typeof message.generation !== 'number' || !Number.isSafeInteger(message.generation) || message.generation < 0) return;
    const owner: Owner = {token: message.token, requestId: message.requestId, generation: message.generation};
    if (message.type === 'release-audio-control') {
      if (control?.owner.token === owner.token && control.owner.requestId === owner.requestId && control.owner.generation === owner.generation) release();
      return;
    }
    const video = Array.from(document.querySelectorAll('video')).find(candidate => candidate.dataset.openjocAudioToken === owner.token);
    if (video === undefined) return;
    if (control?.video === video) {
      control.owner = owner;
      publish(control);
      return;
    }
    release();
    if (nativeMuted?.get === undefined || nativeMuted.set === undefined || Object.hasOwn(video, 'muted')) {
      window.postMessage({source: 'openjoc-audio', type: 'audio-state', ...owner, volume: video.volume, muted: video.muted, suppressed: false}, origin);
      return;
    }
    const current: Control = {video, owner, muted: video.muted, onVolume: (): void => publish(current)};
    try {
      Object.defineProperty(video, 'muted', {configurable: true, enumerable: nativeMuted.enumerable,
        get: (): boolean => current.muted,
        set: (value: boolean): void => {
          const next = Boolean(value);
          if (next === current.muted) return;
          current.muted = next;
          video.dispatchEvent(new Event('volumechange'));
        },
      });
      control = current;
      video.addEventListener('volumechange', current.onVolume);
      publish(current);
    } catch {
      if (control === current) release();
      window.postMessage({source: 'openjoc-audio', type: 'audio-state', ...owner, volume: video.volume, muted: video.muted, suppressed: false}, origin);
    }
  });
})();
