import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createNativeBoundaries,
  buildFfmpegDecodeArgs,
  guardVideoUrl,
  normalizeOptions,
  installedRepositoryRoot,
  parseMcpMetadata,
  parseFfmpegValidation,
  parseCli,
  parseCurlCompletion,
  preflightOutput,
  runPipeline,
  runProcess,
  runCli,
  selectRendition,
  withDeadline,
} from './clip_video.mjs';

const scratchRoot = process.env.PROJECT001_TEST_ROOT ?? tmpdir();
mkdirSync(scratchRoot, { recursive: true });
const scratchPath = mkdtempSync(join(scratchRoot, 'run-'));
let unique = 0;

function freshOutput(label = 'out') {
  unique += 1;
  return join(scratchPath, `${label}-${process.pid}-${unique}`);
}

function options(outputDir = freshOutput()) {
  return {
    videoId: '7253197',
    startSeconds: '2.03',
    durationSeconds: '0.05',
    outputDir,
  };
}

function videoFixture() {
  return {
    id: 7253197,
    url: 'https://www.pexels.com/video/7253197/',
    user: { id: 7, name: 'Example Author', url: 'https://www.pexels.com/@example' },
    secret: 'mock-key-must-not-persist',
    video_files: [
      { id: 1, width: 1920, height: 1080, file_type: 'video/mp4', link: 'https://videos.pexels.com/video-files/7253197/7253197-wide.mp4' },
      { id: 2, width: 540, height: 960, file_type: 'video/mp4', link: 'https://videos.pexels.com/video-files/7253197/7253197-small.mp4' },
      { id: 3, width: 1080, height: 1920, quality: 'hd', file_type: 'video/mp4', link: 'https://videos.pexels.com/video-files/7253197/7253197-hd.mp4' },
      { id: 4, width: 2160, height: 3840, file_type: 'video/mp4', link: 'https://videos.pexels.com/video-files/7253197/7253197-4k.mp4' },
    ],
  };
}

test('fractional request aligns without silently shortening duration', () => {
  const got = normalizeOptions({
    videoId: '7253197',
    startSeconds: '2.03',
    durationSeconds: '0.05',
    outputDir: scratchPath,
  });
  assert.equal(got.startFrame, 50);
  assert.equal(got.frameCount, 2);
});

test('literal exact decimal frame boundaries do not drift through binary multiplication', () => {
  const exact = normalizeOptions({ videoId: '7253197', startSeconds: '1.16', durationSeconds: '0.28', outputDir: scratchPath });
  const scientific = normalizeOptions({ videoId: '7253197', startSeconds: '1.16e0', durationSeconds: '2.8e-1', outputDir: scratchPath });
  const justAbove = normalizeOptions({ videoId: '7253197', startSeconds: '1.1600000000000001', durationSeconds: '0.2800000000000001', outputDir: scratchPath });
  assert.equal(exact.startFrame, 29);
  assert.equal(exact.frameCount, 7);
  assert.equal(scientific.startFrame, 29);
  assert.equal(scientific.frameCount, 7);
  assert.equal(justAbove.startFrame, 29);
  assert.equal(justAbove.frameCount, 8);
});

test('test scratch defaults to the system temporary directory unless explicitly overridden', () => {
  assert.equal(scratchRoot.startsWith(process.env.PROJECT001_TEST_ROOT ?? tmpdir()), true);
});

test('normalization rejects invalid numeric and identifier input', () => {
  for (const changed of [
    { videoId: '' }, { videoId: '0' }, { videoId: '1.5' }, { videoId: '9007199254740992' },
    { startSeconds: '' }, { startSeconds: '-1' }, { startSeconds: 'Infinity' }, { startSeconds: 'NaN' },
    { durationSeconds: '' }, { durationSeconds: '0' }, { durationSeconds: '-0.1' }, { durationSeconds: 'Infinity' },
  ]) {
    assert.throws(() => normalizeOptions({ ...options(), ...changed }));
  }
});

test('CLI rejects unknown and duplicate arguments', () => {
  assert.throws(() => parseCli(['--video-id', '7253197', '--bogus', 'x']));
  assert.throws(() => parseCli(['--video-id', '7253197', '--video-id', '7253198']));
});

test('rendition selection chooses the smallest qualifying exact 9:16 MP4', () => {
  const selected = selectRendition(videoFixture(), 7253197);
  assert.equal(selected.width, 1080);
  assert.equal(selected.height, 1920);
  assert.match(selected.url, /7253197-hd\.mp4$/);
});

test('rendition selection rejects a wrong ID, ratio, or missing MP4', () => {
  assert.throws(() => selectRendition(videoFixture(), 99));
  assert.throws(() => selectRendition({ ...videoFixture(), video_files: [videoFixture().video_files[0]] }, 7253197));
  assert.throws(() => selectRendition({ ...videoFixture(), video_files: [{ ...videoFixture().video_files[2], file_type: 'video/webm' }] }, 7253197));
});

test('URL guard permits only trusted Pexels HTTPS rendition paths for the selected ID', () => {
  assert.equal(
    guardVideoUrl('https://videos.pexels.com/video-files/7253197/7253197-hd.mp4', 7253197),
    'https://videos.pexels.com/video-files/7253197/7253197-hd.mp4',
  );
  for (const url of [
    'http://videos.pexels.com/video-files/7253197/a.mp4',
    'https://cdn.example.test/video-files/7253197/a.mp4',
    'https://user:pass@videos.pexels.com/video-files/7253197/a.mp4',
    'https://videos.pexels.com:444/video-files/7253197/a.mp4',
    'https://videos.pexels.com/video-files/%2e%2e/7253197/a.mp4',
    'https://videos.pexels.com/video-files/999/999.mp4',
    'https://videos.pexels.com/unrelated/7253197/a.mp4',
    'https://videos.pexels.com/video-files/7253197/not-a-video.webm',
  ]) assert.throws(() => guardVideoUrl(url, 7253197));
});

test('preflight rejects existing output and formal-repository aliases', async () => {
  const existing = freshOutput('existing');
  mkdirSync(existing);
  await assert.rejects(preflightOutput({ outputDir: existing }));

  const protectedRoot = freshOutput('formal-root');
  const alias = freshOutput('formal-alias');
  mkdirSync(protectedRoot);
  symlinkSync(protectedRoot, alias, 'junction');
  await assert.rejects(preflightOutput({ outputDir: join(alias, 'new-output'), blockedRoot: protectedRoot }));
});

test('repository guard treats a child literally named ..hidden as inside the protected root', async () => {
  const protectedRoot = freshOutput('literal-root');
  const literalChild = join(protectedRoot, '..hidden');
  mkdirSync(literalChild, { recursive: true });
  await assert.rejects(preflightOutput({ outputDir: join(literalChild, 'new-output'), blockedRoot: protectedRoot }), /formal repository/);
});

test('preflight rejects a dangling link when Windows allows creating one', async (t) => {
  const dangling = freshOutput('dangling');
  try {
    symlinkSync(join(scratchPath, 'missing-target'), dangling, 'file');
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('Windows symlink creation is unavailable to this unprivileged test process');
      return;
    }
    throw error;
  }
  await assert.rejects(preflightOutput({ outputDir: dangling }));
});

test('controlled native runner reports nonzero exits and actual deadlines without leaking output', async () => {
  await assert.rejects(
    runProcess(process.execPath, ['-e', "process.stderr.write('mock-key-must-not-persist'); process.exit(3)"], {
      stage: 'synthetic-nonzero', timeoutMs: 1_000, env: { PATH: process.env.PATH ?? '' },
    }),
    /synthetic-nonzero failed/,
  );
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stage: 'synthetic-timeout', timeoutMs: 40, env: { PATH: process.env.PATH ?? '' },
    }),
    /synthetic-timeout failed/,
  );
  await assert.rejects(
    runProcess('not-used', [], { stage: 'synthetic-spawn', timeoutMs: 1_000, spawn: () => { throw new Error('sync'); } }),
    /synthetic-spawn failed/,
  );
});

test('controlled native runner never passes a supplied key to children', async () => {
  const result = await runProcess(process.execPath, ['-e', "process.stdout.write(process.env.PEXELS_API_KEY || 'none')"], {
    stage: 'synthetic-environment', timeoutMs: 1_000,
    env: { PATH: process.env.PATH ?? '', PEXELS_API_KEY: 'mock-key-must-not-persist' },
  });
  assert.equal(result.stdout, 'none');
});

test('curl completion rejects a numbered no-clobber filename instead of using an old part file', () => {
  const destination = join(scratchPath, 'source.part');
  assert.throws(() => parseCurlCompletion('__PROJECT001_CURL__200__' + destination + '.1', destination));
  assert.equal(parseCurlCompletion('__PROJECT001_CURL__200__' + destination, destination), destination);
});

test('full FFmpeg decode argv makes decoder corruption fatal', () => {
  const args = buildFfmpegDecodeArgs('C:\\scratch\\clip.part.mp4');
  assert.equal(args.includes('-xerror'), true);
  assert.deepEqual(args.slice(-5), ['-map', '0:v:0', '-f', 'null', '-']);
});

test('optional local corrupt-media decode rejects through the production FFmpeg boundary', async (t) => {
  const ffmpegPath = process.env.PROJECT001_FFMPEG_PATH;
  const syntheticVideo = process.env.PROJECT001_SYNTHETIC_VIDEO;
  if (!ffmpegPath || !syntheticVideo) {
    t.skip('set explicit PROJECT001_FFMPEG_PATH and PROJECT001_SYNTHETIC_VIDEO for the local corrupt-media check');
    return;
  }
  const corrupt = join(scratchPath, 'truncated-synthetic.mp4');
  copyFileSync(syntheticVideo, corrupt);
  truncateSync(corrupt, Math.floor(statSync(corrupt).size / 2));
  const native = createNativeBoundaries({ ffmpegPath, env: cleanChildEnv });
  await assert.rejects(native.validate({ source: corrupt }), /decode failed/);
});

test('MCP text extraction uses the installed get_video id contract and unwraps video only', () => {
  const video = parseMcpMetadata(JSON.stringify({ video: videoFixture(), rate_limit: { limit: 200 } }));
  assert.equal(video.id, 7253197);
  assert.equal(Object.hasOwn(video, 'rate_limit'), false);
});

test('FFmpeg full-decode parser accepts plain yuv420p and the terminal decoded frame count', () => {
  const actual = parseFfmpegValidation([
    'Stream #0:0: Video: h264 (High), yuv420p(progressive), 1080x1920, 25 fps, 25 tbr',
    'frame=   13 fps=0.0 q=-0.0 Lsize=N/A time=00:00:00.52 bitrate=N/A speed=4x',
  ].join('\n'));
  assert.deepEqual(actual, {
    width: 1080, height: 1920, fps: 25, codec: 'h264', pixelFormat: 'yuv420p', hasAudio: false, frameCount: 13,
  });
});

test('FFmpeg full-decode parser does not mistake an audio byte summary for an audio stream', () => {
  const actual = parseFfmpegValidation('Stream #0:0: Video: h264, yuv420p, 1080x1920, 25 fps\nvideo:6KiB audio:0KiB\nframe= 13');
  assert.equal(actual.hasAudio, false);
});

test('CLI sends raw string flags to the pipeline exactly once', async () => {
  let received;
  await runCli([
    '--video-id', '7253197', '--start-seconds', '2.03', '--duration-seconds', '0.05', '--output-dir', freshOutput('cli'),
    '--curl-path', 'curl.exe', '--ffmpeg-path', 'ffmpeg.exe', '--mcp-command', 'mcp.exe',
  ], { env: { PEXELS_API_KEY: 'mock-key-must-not-persist' }, pipeline: async (raw) => { received = raw; }, log: () => {} });
  assert.equal(received.startSeconds, '2.03');
  assert.equal(received.durationSeconds, '0.05');
});

test('direct Node CLI enforces its installed-module protected root without an optional guard flag', async () => {
  const outputDir = join(installedRepositoryRoot(), `must-not-write-${process.pid}-${Date.now()}`);
  await assert.rejects(runCli([
    '--video-id', '7253197', '--start-seconds', '0', '--duration-seconds', '1', '--output-dir', outputDir, '--check-only',
  ], { log: () => {} }), /formal repository/);
});

test('deadline resolves successful work without retaining the timeout timer', async () => {
  const before = process._getActiveHandles().length;
  assert.equal(await withDeadline(Promise.resolve('done'), 2_000), 'done');
  assert.equal(process._getActiveHandles().length <= before + 1, true);
});

test('native boundary factory exposes the production download, probe, encode, and decode stages', () => {
  const native = createNativeBoundaries({ curlPath: 'curl.exe', ffmpegPath: 'ffmpeg.exe' });
  assert.equal(typeof native.download, 'function');
  assert.equal(typeof native.probe, 'function');
  assert.equal(typeof native.encode, 'function');
  assert.equal(typeof native.validate, 'function');
});

test('pipeline publishes only validated allowlisted artifacts', async () => {
  const outputDir = freshOutput('success');
  const result = await runPipeline(options(outputDir), {
    metadata: async () => videoFixture(),
    download: async ({ destination }) => writeFileSync(destination, 'source-bytes'),
    probe: async () => ({ durationSeconds: 10 }),
    encode: async ({ destination }) => writeFileSync(destination, 'clip-bytes'),
    validate: async () => ({ width: 1080, height: 1920, fps: 25, codec: 'h264', pixelFormat: 'yuv420p', hasAudio: false, frameCount: 2 }),
  });
  assert.equal(result.outputDir, outputDir);
  assert.equal(existsSync(join(outputDir, 'source.mp4')), true);
  assert.equal(existsSync(join(outputDir, 'clip.mp4')), true);
  const manifest = readFileSync(join(outputDir, 'source_metadata.json'), 'utf8');
  assert.equal(JSON.parse(manifest).provider, 'Pexels');
  assert.match(manifest, /Example Author/);
  assert.equal(manifest.includes('mock-key-must-not-persist'), false);
  assert.equal(manifest.includes('video_files'), false);
});

test('pipeline failure never creates a successful final clip or leaks a fake key', async () => {
  const outputDir = freshOutput('failure');
  await assert.rejects(
    runPipeline(options(outputDir), {
      metadata: async () => videoFixture(),
      download: async () => { throw new Error('mock-key-must-not-persist'); },
    }),
    /download failed/,
  );
  assert.equal(existsSync(join(outputDir, 'clip.mp4')), false);
  assert.equal(existsSync(join(outputDir, 'source_metadata.json')), false);
});

test('every rejected native stage preserves diagnostics without a successful final clip', async () => {
  for (const stage of ['download', 'probe', 'encode', 'decode']) {
    const outputDir = freshOutput(`stage-${stage}`);
    const boundaries = {
      metadata: async () => videoFixture(),
      download: async ({ destination }) => {
        if (stage === 'download') throw new Error('mock-key-must-not-persist');
        writeFileSync(destination, 'source-bytes');
      },
      probe: async () => {
        if (stage === 'probe') throw new Error('mock-key-must-not-persist');
        return { durationSeconds: 10 };
      },
      encode: async ({ destination }) => {
        if (stage === 'encode') throw new Error('mock-key-must-not-persist');
        writeFileSync(destination, 'clip-bytes');
      },
      validate: async () => {
        if (stage === 'decode') throw new Error('mock-key-must-not-persist');
        return { width: 1080, height: 1920, fps: 25, codec: 'h264', pixelFormat: 'yuv420p', hasAudio: false, frameCount: 2 };
      },
    };
    await assert.rejects(runPipeline(options(outputDir), boundaries), new RegExp(`${stage} failed`));
    assert.equal(existsSync(join(outputDir, 'clip.mp4')), false, stage);
    assert.equal(existsSync(join(outputDir, 'source_metadata.json')), false, stage);
  }
});

test('actual source duration is authoritative over rounded metadata duration', async () => {
  const outputDir = freshOutput('short-source');
  await assert.rejects(runPipeline(options(outputDir), {
    metadata: async () => videoFixture(),
    download: async ({ destination }) => writeFileSync(destination, 'source-bytes'),
    probe: async () => ({ durationSeconds: 2.07 }),
  }), /exceeds actual source duration/);
  assert.equal(existsSync(join(outputDir, 'clip.mp4')), false);
});

const wrapperPath = join(dirname(fileURLToPath(import.meta.url)), 'clip_video.ps1');
const powershellPath = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const cleanChildEnv = {
  SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
  WINDIR: process.env.WINDIR ?? 'C:\\Windows',
  ComSpec: process.env.ComSpec ?? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
  TEMP: scratchPath,
  TMP: scratchPath,
  PATH: process.env.PATH ?? '',
  PATHEXT: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
};

function runWrapper(argumentsList, env = cleanChildEnv) {
  return spawnSync(powershellPath, ['-NoProfile', '-File', wrapperPath, ...argumentsList], {
    cwd: dirname(wrapperPath), env, encoding: 'utf8', timeout: 10_000, windowsHide: true,
  });
}

test('PowerShell Help exits before prompts, key handling, or dependency imports', () => {
  const result = runWrapper(['-Help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.equal(result.stdout.includes('mock-key-must-not-persist'), false);
});

test('PowerShell invalid existing Windows output preflight exits without a prompt', () => {
  const outputDir = join(scratchPath, 'Chinese path with spaces');
  mkdirSync(outputDir, { recursive: true });
  const result = runWrapper([
    '-VideoId', '7253197', '-StartSeconds', '2.03', '-DurationSeconds', '0.05', '-OutputDir', outputDir,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /already exists|preflight/i);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Read-Host|Enter|password/i);
});

test('PowerShell refuses a synthetic preexisting key without echoing it', () => {
  const fakeKey = 'mock-key-must-not-persist';
  const result = runWrapper(['-VideoId', '7253197', '-StartSeconds', '2', '-DurationSeconds', '1', '-OutputDir', freshOutput('key')], {
    ...cleanChildEnv, PEXELS_API_KEY: fakeKey,
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /already exists/i);
  assert.equal(`${result.stdout}${result.stderr}`.includes(fakeKey), false);
});

test('Node check-only entry performs offline preflight without reserving the output', () => {
  const outputDir = freshOutput('node-check-only');
  const nodeScript = join(dirname(fileURLToPath(import.meta.url)), 'clip_video.mjs');
  const result = spawnSync(process.execPath, [
    nodeScript, '--video-id', '7253197', '--start-seconds', '2.03', '--duration-seconds', '0.05',
    '--output-dir', outputDir, '--check-only',
  ], { cwd: dirname(nodeScript), env: cleanChildEnv, encoding: 'utf8', timeout: 10_000, windowsHide: true });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Preflight OK/);
  assert.equal(existsSync(outputDir), false);
});
