// pattern: Functional Core

import {extractBilibiliAudioCandidates} from '../src/bilibili-manifest.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const candidates = extractBilibiliAudioCandidates({
    data: {
      dash: {
        audio: [
          {id: 1, codecs: 'mp4a.40.2', baseUrl: 'https://audio.example.com/a.m4s'},
          {id: 2, codecs: 'ec-3', mimeType: 'audio/mp4', bandwidth: 128000, baseUrl: 'https://audio.example.com/b.m4s', backupUrl: ['https://audio.example.com/c.m4s']},
        ],
        dolby: {
          audio: [{id: 'dolby', codecs: 'ec-3', base_url: 'https://audio.example.com/d.m4s'}],
        },
      },
    },
  });
  assert(candidates.length === 2, 'ordinary mp4a audio is not a JOC candidate');
  const eac3 = candidates.find((candidate) => candidate.source === 'ec-3');
  const dolby = candidates.find((candidate) => candidate.source === 'dolby');
  if (eac3 === undefined || dolby === undefined) throw new Error('Dolby/E-AC-3 candidates are retained');
  assert(eac3.backupUrls[0] === 'https://audio.example.com/c.m4s', 'backup URLs are retained');
  assert(extractBilibiliAudioCandidates({data: {dash: {audio: [{codecs: 'mp4a.40.2', baseUrl: 'https://audio.example.com/a.m4s'}]}}}).length === 0, 'ordinary audio cannot activate OpenJOC');
}

run();
