// pattern: Functional Core

import {createMockBilibiliScenario} from '../src/mock-bilibili-harness.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const scenario = createMockBilibiliScenario();
  assert(scenario.mediaKey.bvid === 'BV-openjoc-mock', 'mock identity is deterministic');
  assert(scenario.initializationRange.start === 0, 'mock initialization starts at byte zero');
  assert(scenario.mediaRanges.length === 3, 'mock exposes bounded media ranges');
  assert(scenario.events.some((event) => event.type === 'pause'), 'mock covers pause');
  assert(scenario.events.some((event) => event.type === 'seek'), 'mock covers seek');
  assert(scenario.events.some((event) => event.type === 'buffering'), 'mock covers buffering');
  assert(scenario.events.some((event) => event.type === 'media-change'), 'mock covers media change');
}

run();
