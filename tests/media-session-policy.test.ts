// pattern: Functional Core

import {isContentSessionReset, isStaleContentGeneration, mediaSessionRestartRequired, nextManifestGeneration, sessionTargetMatches, shouldResetTabSession, type MediaSessionSnapshot} from '../src/media-session-policy.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const previous: MediaSessionSnapshot = {mediaKey: 'A', candidateUrl: 'https://media.example/audio.m4s', generation: 4, started: true};
  const nextMedia: MediaSessionSnapshot = {...previous, mediaKey: 'B'};
  const nextCandidate: MediaSessionSnapshot = {...previous, candidateUrl: 'https://media.example/other.m4s'};
  assert(mediaSessionRestartRequired(previous, nextMedia), 'a new media identity restarts even when the candidate URL is unchanged');
  assert(nextManifestGeneration(previous, nextMedia) === 5, 'a media change advances the lifecycle generation');
  assert(mediaSessionRestartRequired(previous, nextCandidate), 'a changed candidate restarts the session');
  assert(!mediaSessionRestartRequired(previous, previous), 'an unchanged media session does not restart');
  assert(nextManifestGeneration(previous, previous) === 4, 'an unchanged manifest preserves its generation');

  const currentMedia: MediaSessionSnapshot = {...previous, mediaKey: 'B', generation: 6};
  assert(isStaleContentGeneration(currentMedia, 5), 'an old media generation cannot replace a running newer session');
  assert(!isStaleContentGeneration(currentMedia, 6), 'the current media generation remains eligible');

  const disabledMedia: MediaSessionSnapshot = {...currentMedia, mediaKey: 'A', generation: 10, started: false};
  assert(isStaleContentGeneration(disabledMedia, 5), 'a delayed old-media message cannot resurrect a disabled session');
  assert(!isStaleContentGeneration(disabledMedia, 10), 'a new media identity at the current generation remains eligible');
  assert(sessionTargetMatches(previous, {mediaKey: 'A', generation: 4}), 'a stop operation matches its captured session');
  assert(!sessionTargetMatches(currentMedia, {mediaKey: 'A', generation: 4}), 'an old stop operation cannot stop the replacement session');
  assert(!shouldResetTabSession('loading'), 'a late tab loading event cannot stop a newly established content session');
  assert(!shouldResetTabSession('complete'), 'a completed tab update does not clear an active session');
  assert(isContentSessionReset(currentMedia, 'B', 1), 'a refreshed content script can recover the same media with a reset generation');
  assert(!isContentSessionReset(currentMedia, 'A', 7), 'a forward generation is not treated as a content reload');
  assert(!isContentSessionReset(currentMedia, 'A', 1), 'a different media identity is not recovered as the old session');
}

run();
