import {
  constants as fsConstants,
  copyFile,
  lstat,
  mkdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as nodeSpawn } from 'node:child_process';

const FPS = 25;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const ALLOWED_ENV = new Set(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'TEMP', 'TMP', 'PATHEXT']);

export function buildFfmpegDecodeArgs(source) {
  return ['-hide_banner', '-xerror', '-i', source, '-map', '0:v:0', '-f', 'null', '-'];
}

export function parseCurlCompletion(output, destination) {
  const match = String(output).match(/__PROJECT001_CURL__(\d{3})__(.+?)\s*$/s);
  if (!match || match[1] !== '200') fail('download failed');
  let effective;
  try { effective = resolve(match[2]); } catch { fail('download failed'); }
  if (effective !== resolve(destination)) fail('download failed');
  return effective;
}

export function installedRepositoryRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function parseMcpMetadata(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !parsed.video || typeof parsed.video !== 'object') {
    fail('MCP metadata is malformed');
  }
  return parsed.video;
}

export function withDeadline(promise, milliseconds) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('deadline')), milliseconds);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolvePromise(value); },
      (error) => { clearTimeout(timer); rejectPromise(error); },
    );
  });
}

export function parseFfmpegValidation(output) {
  const videoLine = String(output).split(/\r?\n/).find((line) => /Video:/i.test(line));
  const dimensions = videoLine?.match(/(\d{2,5})x(\d{2,5})/);
  const fpsMatch = videoLine?.match(/(\d+(?:\.\d+)?)\s+fps\b/i);
  const codecMatch = videoLine?.match(/Video:\s*([^\s,(]+)/i);
  const pixelMatch = videoLine?.match(/,\s*(yuv[0-9a-z]+|nv[0-9a-z]+|rgb[0-9a-z]+)/i);
  const frameMatches = [...String(output).matchAll(/frame=\s*(\d+)/g)];
  return {
    width: Number(dimensions?.[1]), height: Number(dimensions?.[2]), fps: Number(fpsMatch?.[1]),
    codec: codecMatch?.[1], pixelFormat: pixelMatch?.[1], hasAudio: /^\s*Stream #.*:\s*Audio:/mi.test(output),
    frameCount: Number(frameMatches.at(-1)?.[1]),
  };
}

function fail(message) {
  throw new Error(message);
}

function parseFinite(value, name, { positive = false } = {}) {
  if (typeof value !== 'string' && typeof value !== 'number') fail(`${name} is required`);
  const text = String(value).trim();
  if (text === '') fail(`${name} must be finite`);
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || (positive && number <= 0)) {
    fail(`${name} must be ${positive ? 'positive' : 'nonnegative'} and finite`);
  }
  return { number, text };
}

function decimalFrames(text, roundUp) {
  const match = text.match(/^\+?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
  if (!match || text.length > 512) fail('Requested frame range is unsafe');
  const exponent = Number(match[4] ?? '0');
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400) fail('Requested frame range is unsafe');
  const integer = match[1] ?? '0';
  const fraction = match[2] ?? match[3] ?? '';
  const digits = `${integer}${fraction}`.replace(/^0+(?=\d)/, '');
  let numerator = BigInt(digits || '0') * BigInt(FPS);
  const scale = fraction.length - exponent;
  let denominator = 1n;
  if (scale >= 0) denominator = 10n ** BigInt(scale);
  else numerator *= 10n ** BigInt(-scale);
  const frames = roundUp ? (numerator + denominator - 1n) / denominator : numerator / denominator;
  if (frames > BigInt(Number.MAX_SAFE_INTEGER)) fail('Requested frame range is unsafe');
  return Number(frames);
}

export function normalizeOptions({ videoId, startSeconds, durationSeconds, outputDir }) {
  const idText = String(videoId ?? '');
  if (!/^[1-9]\d*$/.test(idText) || !Number.isSafeInteger(Number(idText))) {
    fail('VideoId must be a positive safe integer');
  }
  const start = parseFinite(startSeconds, 'StartSeconds');
  const duration = parseFinite(durationSeconds, 'DurationSeconds', { positive: true });
  const startFrame = decimalFrames(start.text, false);
  const frameCount = decimalFrames(duration.text, true);
  if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(frameCount) || frameCount <= 0 ||
      !Number.isSafeInteger(startFrame + frameCount)) {
    fail('Requested frame range is unsafe');
  }
  if (typeof outputDir !== 'string' || outputDir.trim() === '' || !isAbsolute(outputDir)) {
    fail('OutputDir must be an absolute path');
  }
  return {
    videoId: Number(idText),
    requestedStartSeconds: start.number,
    requestedDurationSeconds: duration.number,
    outputDir,
    startFrame,
    frameCount,
    effectiveStartSeconds: startFrame / FPS,
    effectiveDurationSeconds: frameCount / FPS,
    effectiveEndSeconds: (startFrame + frameCount) / FPS,
  };
}

export function parseCli(argv) {
  const valueFlags = new Map([
    ['--video-id', 'videoId'], ['--start-seconds', 'startSeconds'],
    ['--duration-seconds', 'durationSeconds'], ['--output-dir', 'outputDir'],
    ['--curl-path', 'curlPath'], ['--ffmpeg-path', 'ffmpegPath'],
    ['--mcp-command', 'mcpCommand'], ['--mcp-script', 'mcpScript'], ['--blocked-root', 'blockedRoot'],
  ]);
  const booleanFlags = new Map([['--help', 'help'], ['--check-only', 'checkOnly']]);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = valueFlags.get(flag) ?? booleanFlags.get(flag);
    if (!key) fail(`Unknown argument: ${flag}`);
    if (Object.hasOwn(parsed, key)) fail(`Duplicate argument: ${flag}`);
    if (valueFlags.has(flag)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) fail(`Missing value for ${flag}`);
      parsed[key] = value;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

async function pathExists(pathname) {
  try {
    await lstat(pathname);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function isWithin(root, candidate) {
  const part = relative(root, candidate);
  return part === '' || (part !== '..' && !part.startsWith('..\\') && !part.startsWith('../') && !isAbsolute(part));
}

export async function preflightOutput({ outputDir, blockedRoot }) {
  if (typeof outputDir !== 'string' || !isAbsolute(outputDir)) fail('OutputDir must be an absolute path');
  const resolvedOutput = resolve(outputDir);
  if (await pathExists(resolvedOutput)) fail('OutputDir already exists');
  const parent = dirname(resolvedOutput);
  let realParent;
  try {
    const parentInfo = await stat(parent);
    if (!parentInfo.isDirectory()) fail('OutputDir parent must be an existing directory');
    realParent = await realpath(parent);
  } catch (error) {
    if (error?.message?.startsWith('OutputDir parent')) throw error;
    fail('OutputDir parent must be an existing directory');
  }
  if (blockedRoot) {
    let realBlocked;
    try { realBlocked = await realpath(blockedRoot); } catch { fail('Blocked root is unavailable'); }
    const realCandidate = resolve(realParent, basename(resolvedOutput));
    if (isWithin(realBlocked, realCandidate)) fail('OutputDir must not be inside the formal repository');
  }
  return { outputDir: resolvedOutput, parentRealPath: realParent, blockedRealPath: blockedRoot ? await realpath(blockedRoot) : null };
}

export function guardVideoUrl(value, videoId) {
  if (typeof value !== 'string' || /%2e|%2f|%5c/i.test(value)) fail('Selected URL path is unsafe');
  let url;
  try { url = new URL(value); } catch { fail('Selected URL is invalid'); }
  if (url.protocol !== 'https:' || url.hostname !== 'videos.pexels.com' || url.port !== '' || url.username || url.password) {
    fail('Selected URL is not an allowed Pexels HTTPS URL');
  }
  const rawPath = url.pathname.toLowerCase();
  if (/%2e|%2f|%5c/.test(rawPath) || rawPath.includes('..')) fail('Selected URL path is unsafe');
  const requiredPath = new RegExp(`^/video-files/${String(videoId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^/]+\\.mp4$`, 'i');
  if (!requiredPath.test(url.pathname)) fail('Selected URL does not match the allowed video file path');
  return url.toString();
}

export function selectRendition(video, videoId) {
  if (!video || String(video.id) !== String(videoId) || !Array.isArray(video.video_files)) {
    fail('Metadata does not match VideoId');
  }
  const candidates = video.video_files
    .filter((file) => file && file.file_type === 'video/mp4' && Number.isSafeInteger(file.width) &&
      Number.isSafeInteger(file.height) && file.width >= 1080 && file.height >= 1920 && file.width * 16 === file.height * 9)
    .map((file) => ({
      id: Number.isSafeInteger(file.id) ? file.id : null,
      width: file.width,
      height: file.height,
      quality: typeof file.quality === 'string' ? file.quality : null,
      url: guardVideoUrl(file.link, videoId),
    }))
    .sort((left, right) => (left.width * left.height) - (right.width * right.height));
  if (candidates.length === 0) fail('No qualifying 9:16 MP4 rendition exists');
  return candidates[0];
}


function sanitizedEnv(source = {}) {
  const env = {};
  for (const name of ALLOWED_ENV) {
    if (typeof source[name] === 'string') env[name] = source[name];
  }
  return env;
}

export async function runProcess(executable, args, { stage, timeoutMs, env = process.env, spawn = nodeSpawn } = {}) {
  if (!stage || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail('Native process options are invalid');
  return new Promise((resolvePromise, rejectPromise) => {
    let finished = false;
    let output = '';
    let timer;
    const finish = (result, error) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (error) rejectPromise(new Error(`${stage} failed`));
      else resolvePromise(result);
    };
    let child;
    try {
      child = spawn(executable, args, { shell: false, windowsHide: true, env: sanitizedEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { finish(null, true); return; }
    const take = (chunk) => {
      if (output.length < MAX_OUTPUT_BYTES) output += chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - output.length);
      if (output.length >= MAX_OUTPUT_BYTES) child.kill();
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    timer = setTimeout(() => child.kill(), timeoutMs);
    child.once('error', () => finish(null, true));
    child.once('close', (code, signal) => {
      if (code !== 0 || signal || output.length >= MAX_OUTPUT_BYTES) finish(null, true);
      else finish({ stdout: output, stderr: '' });
    });
  });
}

function stageFailure(stage, operation) {
  return Promise.resolve().then(operation).catch(() => { throw new Error(`${stage} failed`); });
}

function secondsText(value) {
  return value.toFixed(6).replace(/(?:\.0+|(?:(\.\d*?)0+))$/, '$1');
}

async function downloadWithCurl({ url, destination, curlPath = 'curl.exe', env }) {
  const result = await runProcess(curlPath, [
    '-q', '--silent', '--show-error', '--fail', '--proto', '=https', '--noproxy', '*', '--proxy', '',
    '--connect-timeout', '15', '--max-time', '180', '--max-filesize', String(MAX_DOWNLOAD_BYTES), '--no-clobber',
    '--output', destination, '--write-out', '__PROJECT001_CURL__%{http_code}__%{filename_effective}', url,
  ], { stage: 'download', timeoutMs: 180_000, env });
  parseCurlCompletion(result.stdout, destination);
}

async function probeWithFfmpeg({ source, ffmpegPath, env }) {
  const result = await runProcess(ffmpegPath, [
    '-hide_banner', '-xerror', '-i', source, '-map', '0:v:0', '-f', 'null', '-',
  ], { stage: 'probe', timeoutMs: 30_000, env });
  const match = result.stdout.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const durationSeconds = match ? (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]) : NaN;
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) throw new Error('probe failed');
  return { durationSeconds };
}

async function encodeWithFfmpeg({ source, destination, options, ffmpegPath, env }) {
  await runProcess(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-ss', secondsText(options.effectiveStartSeconds), '-i', source,
    '-frames:v', String(options.frameCount), '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=25',
    '-r', '25', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-n', destination,
  ], { stage: 'encode', timeoutMs: 180_000, env });
}

async function validateWithFfmpeg({ source, ffmpegPath, env }) {
  const result = await runProcess(ffmpegPath, buildFfmpegDecodeArgs(source), { stage: 'decode', timeoutMs: 180_000, env });
  return parseFfmpegValidation(result.stdout);
}

export function createNativeBoundaries({ curlPath = 'curl.exe', ffmpegPath, env = process.env } = {}) {
  return {
    download: ({ url, destination }) => downloadWithCurl({ url, destination, curlPath, env }),
    probe: ({ source }) => probeWithFfmpeg({ source, ffmpegPath, env }),
    encode: ({ source, destination, options }) => encodeWithFfmpeg({ source, destination, options, ffmpegPath, env }),
    validate: ({ source }) => validateWithFfmpeg({ source, ffmpegPath, env }),
  };
}

function assertClipValidation(actual, options) {
  const codec = String(actual?.codec ?? '').toLowerCase();
  if (actual?.width !== 1080 || actual?.height !== 1920 || actual?.fps !== 25 ||
      !['h264', 'avc1'].includes(codec) || actual?.pixelFormat !== 'yuv420p' || actual?.hasAudio !== false ||
      actual?.frameCount !== options.frameCount) fail('decode validation failed');
}

async function requireUsableFile(pathname, limit = MAX_DOWNLOAD_BYTES) {
  const info = await stat(pathname);
  if (!info.isFile() || info.size <= 0 || info.size > limit) fail('artifact validation failed');
}

async function publishExclusive(part, finalPath) {
  await copyFile(part, finalPath, fsConstants.COPYFILE_EXCL);
  try { await unlink(part); } catch { /* Publication succeeded; preserve its recoverable intermediate. */ }
}

async function reserveOutput(preflight) {
  if (await pathExists(preflight.outputDir)) fail('OutputDir already exists');
  const currentParent = await realpath(dirname(preflight.outputDir));
  if (currentParent !== preflight.parentRealPath) fail('OutputDir parent changed during preflight');
  if (preflight.blockedRealPath && isWithin(preflight.blockedRealPath, resolve(currentParent, basename(preflight.outputDir)))) {
    fail('OutputDir must not be inside the formal repository');
  }
  try { await mkdir(preflight.outputDir, { recursive: false }); } catch { fail('OutputDir reservation failed'); }
}

function publicManifest(video, rendition, options, validation) {
  return {
    schemaVersion: '1.0',
    provider: 'Pexels',
    videoId: options.videoId,
    author: typeof video?.user?.name === 'string' ? video.user.name : null,
    sourcePage: typeof video?.url === 'string' ? video.url : null,
    retrievedAt: new Date().toISOString(),
    rendition: { id: rendition.id, width: rendition.width, height: rendition.height, quality: rendition.quality },
    clip: {
      requestedStartSeconds: options.requestedStartSeconds,
      requestedDurationSeconds: options.requestedDurationSeconds,
      effectiveStartSeconds: options.effectiveStartSeconds,
      effectiveDurationSeconds: options.effectiveDurationSeconds,
      effectiveEndSeconds: options.effectiveEndSeconds,
      startFrame: options.startFrame,
      frameCount: options.frameCount,
    },
    validation: {
      width: validation.width, height: validation.height, fps: validation.fps, codec: validation.codec,
      pixelFormat: validation.pixelFormat, hasAudio: validation.hasAudio, frameCount: validation.frameCount,
    },
  };
}

export async function runPipeline(rawOptions, boundaries = {}) {
  const options = normalizeOptions(rawOptions);
  const preflight = await preflightOutput({ outputDir: options.outputDir, blockedRoot: boundaries.blockedRoot });
  const native = createNativeBoundaries(boundaries);
  const video = await stageFailure('metadata', () => boundaries.metadata
    ? boundaries.metadata(options.videoId)
    : fetchMetadataWithMcp({ videoId: options.videoId, apiKey: boundaries.apiKey, mcpCommand: boundaries.mcpCommand, mcpScript: boundaries.mcpScript }));
  const rendition = selectRendition(video, options.videoId);
  await stageFailure('reserve', () => reserveOutput(preflight));
  const sourcePart = resolve(preflight.outputDir, 'source.part');
  const clipPart = resolve(preflight.outputDir, 'clip.part.mp4');
  await stageFailure('download', () => (boundaries.download ?? native.download)({ url: rendition.url, destination: sourcePart }));
  await requireUsableFile(sourcePart);
  const probe = await stageFailure('probe', () => (boundaries.probe ?? native.probe)({ source: sourcePart }));
  if (!Number.isFinite(probe?.durationSeconds) || options.effectiveEndSeconds > probe.durationSeconds + 1e-9) {
    fail('Requested clip exceeds actual source duration');
  }
  await stageFailure('encode', () => (boundaries.encode ?? native.encode)({ source: sourcePart, destination: clipPart, options }));
  await requireUsableFile(clipPart);
  const validation = await stageFailure('decode', () => (boundaries.validate ?? native.validate)({ source: clipPart, options }));
  assertClipValidation(validation, options);
  const manifest = JSON.stringify(publicManifest(video, rendition, options, validation), null, 2);
  await publishExclusive(sourcePart, resolve(preflight.outputDir, 'source.mp4'));
  await publishExclusive(clipPart, resolve(preflight.outputDir, 'clip.mp4'));
  await writeFile(resolve(preflight.outputDir, 'source_metadata.json'), manifest, { encoding: 'utf8', flag: 'wx' });
  return { outputDir: preflight.outputDir };
}

async function fetchMetadataWithMcp({ videoId, apiKey, mcpCommand, mcpScript }) {
  if (typeof apiKey !== 'string' || apiKey === '' || !mcpCommand) fail('Runtime MCP configuration is unavailable');
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'), import('@modelcontextprotocol/sdk/client/stdio.js'),
  ]);
  const transport = new StdioClientTransport({
    command: mcpCommand, args: mcpScript ? [mcpScript] : [], env: { ...sanitizedEnv(process.env), PEXELS_API_KEY: apiKey }, stderr: 'pipe',
  });
  const client = new Client({ name: 'project001-clip-entry', version: '1.0.0' });
  try {
    transport.stderr?.on?.('data', () => {});
    const deadlineAt = Date.now() + 60_000;
    const remaining = () => {
      const milliseconds = deadlineAt - Date.now();
      if (milliseconds <= 0) throw new Error('deadline');
      return milliseconds;
    };
    await withDeadline(client.connect(transport), remaining());
    const response = await withDeadline(client.callTool({ name: 'pexels_get_video', arguments: { id: videoId } }), remaining());
    const text = response?.content?.find((item) => item.type === 'text')?.text;
    return parseMcpMetadata(text);
  } finally {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
    await Promise.allSettled([client.close(), transport.close()]);
  }
}

function usage() {
  return 'Usage: node clip_video.mjs --video-id ID --start-seconds SECONDS --duration-seconds SECONDS --output-dir ABSOLUTE_PATH --curl-path PATH --ffmpeg-path PATH --mcp-command PATH [--mcp-script PATH]';
}

export async function runCli(argv, { env = process.env, pipeline = runPipeline, log = console.log } = {}) {
  const parsed = parseCli(argv);
  if (parsed.help) { console.log(usage()); return; }
  const options = normalizeOptions(parsed);
  const protectedRoot = installedRepositoryRoot();
  if (parsed.blockedRoot && resolve(parsed.blockedRoot) !== protectedRoot) fail('Blocked root must match the installed formal repository');
  if (parsed.checkOnly) {
    await preflightOutput({ outputDir: options.outputDir, blockedRoot: protectedRoot });
    log('Preflight OK');
    return;
  }
  for (const name of ['curlPath', 'ffmpegPath', 'mcpCommand']) {
    if (!parsed[name]) fail(`Missing required runtime argument: ${name}`);
  }
  await pipeline(parsed, { ...parsed, blockedRoot: protectedRoot, apiKey: env.PEXELS_API_KEY });
  log('Clip created');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
