// pattern: Imperative Shell

import {createSourceRuntime} from './extension-runtime.mjs';

export async function createNativeAudioRuntime() {
  class Media extends EventTarget {
    #muted = false;
    #volume = 1;
    dataset = {};
    isConnected = true;
    get muted() {return this.#muted;}
    set muted(value) {if (this.#muted === Boolean(value)) return; this.#muted = Boolean(value); this.dispatchEvent(new Event('volumechange'));}
    get volume() {return this.#volume;}
    set volume(value) {if (this.#volume === value) return; this.#volume = value; this.dispatchEvent(new Event('volumechange'));}
  }
  const video = new Media();
  const events = [];
  const listeners = [];
  let onState = () => {};
  const window = {addEventListener(name, callback) {if (name === 'message') listeners.push(callback);},
    postMessage(message) {events.push(message); onState(message);}};
  const runtime = createSourceRuntime({window, document: {querySelectorAll() {return [video];}}, HTMLMediaElement: Media, Event});
  await runtime.load('bilibili-audio-controls.js');
  return {video, events, window,
    onState(callback) {onState = callback;},
    physicalMuted() {return Object.getOwnPropertyDescriptor(Media.prototype, 'muted').get.call(video);},
    dispatch(message) {for (const listener of listeners) listener({source: window, origin: 'https://www.bilibili.com', data: message});},
  };
}
