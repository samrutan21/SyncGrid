import { averageHash } from '../core/shotHash';
import { fps, tcToFrames } from '../core/timecode';
import type { CategoryConfig, Item, Version } from '../core/types';
import { app, applyShotHashes, bumpBlobs, toast, updateProject } from '../state/app';
import { blobKeys, store } from '../storage/store';

/**
 * Screenshot capture. Frames are grabbed from the locally loaded video with a
 * hidden <video> + <canvas>, stored as small JPEGs in IndexedDB. Nothing is
 * uploaded anywhere.
 */

const THUMB_W = 384;

/** Absolute frame → seconds into the loaded file. */
export function frameToSeconds(frame: number, version: Version, defaultStart: string): number {
  const start = tcToFrames(version.video?.startTC || defaultStart, version.rate.timebase);
  return (frame - (Number.isNaN(start) ? 0 : start)) / fps(version.rate);
}
export function secondsToFrame(sec: number, version: Version, defaultStart: string): number {
  const start = tcToFrames(version.video?.startTC || defaultStart, version.rate.timebase);
  return Math.round(sec * fps(version.rate) + 1e-6) + (Number.isNaN(start) ? 0 : start);
}

/** Frame to photograph. GFX and archival use the middle, so an animate-on isn't the picture. */
export function shotFrameOf(item: Item, cat: CategoryConfig): number {
  const last = Math.max(item.recIn, item.recOut - 1);
  const clamp = (f: number) => Math.min(last, Math.max(item.recIn, Math.round(f)));
  if (item.shotFrame !== undefined) return clamp(item.shotFrame);
  const span = item.recOut - item.recIn;
  if (span <= 1) return item.recIn;
  if (cat.screenshotAt === 'in') return clamp(item.recIn + 2);
  return item.recIn + Math.floor(span / 2);
}

let running: { versionId: string; cancel: boolean } | null = null;

export function cancelCapture() {
  if (running) running.cancel = true;
}

/** Capture screenshots for every video item that doesn't have one yet. */
export async function captureMissing(version: Version, force = false) {
  const s = app.get();
  const p = s.project;
  const url = s.videoUrls[version.id];
  if (!p || !url) return;
  if (running && running.versionId === version.id) return;
  if (running) running.cancel = true;
  const job = { versionId: version.id, cancel: false };
  running = job;

  const existing = new Set(force ? [] : await store.listBlobKeys(blobKeys.shotPrefix(p.id, version.id)));
  const todo: { key: string; sec: number; frame: number; catKey: string; itemId: string }[] = [];
  for (const cat of p.categories) {
    if (!cat.columns.some((c) => c.type === 'auto' && c.auto === 'screenshot' && !c.hidden)) continue;
    for (const it of version.items[cat.key] ?? []) {
      if (it.kind !== 'video') continue;
      const frame = shotFrameOf(it, cat);
      const key = blobKeys.shot(p.id, version.id, it.id);
      if (existing.has(key) && it.capturedFrame === frame) continue;
      todo.push({ key, frame, catKey: cat.key, itemId: it.id, sec: frameToSeconds(frame, version, p.settings.defaultVideoStartTC) });
    }
  }
  if (!todo.length) {
    running = null;
    void syncShotNotes(p.id, version.id);
    return;
  }
  todo.sort((a, b) => a.sec - b.sec);
  app.set({ capture: { done: 0, total: todo.length } });

  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.src = url;
  const canvas = document.createElement('canvas');
  try {
    await once(video, 'loadeddata', 15000);
    const w = THUMB_W;
    const h = Math.round((THUMB_W * (video.videoHeight || 9)) / (video.videoWidth || 16));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    let done = 0;
    let skipped = 0;
    const pinned: { catKey: string; itemId: string; frame: number; hash?: string }[] = [];
    const flush = () => {
      if (!pinned.length) return;
      const batch = pinned.splice(0);
      updateProject((proj) => {
        const ver = proj.episodes.flatMap((e) => e.versions).find((v) => v.id === version.id);
        for (const b of batch) {
          const it = ver?.items[b.catKey]?.find((i) => i.id === b.itemId);
          const cat = proj.categories.find((c) => c.key === b.catKey);
          if (it && cat && shotFrameOf(it, cat) === b.frame) {
            if (b.hash && it.shotHash !== b.hash) delete it.shotCompared;
            it.capturedFrame = b.frame;
            if (b.hash) it.shotHash = b.hash;
          }
        }
      });
    };
    for (const t of todo) {
      if (job.cancel) break;
      if (t.sec < -0.05 || t.sec > video.duration + 0.05) {
        skipped++;
        done++;
        continue;
      }
      await seekTo(video, Math.max(0, t.sec), 8000);
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
      if (blob) {
        await store.putBlob(t.key, blob);
        pinned.push({ catKey: t.catKey, itemId: t.itemId, frame: t.frame, hash: await hashBlob(blob) });
      }
      done++;
      if (done % 4 === 0 || done === todo.length) {
        flush();
        app.set({ capture: { done, total: todo.length } });
        bumpBlobs();
      }
    }
    flush();
    if (skipped) toast(`${skipped} screenshot(s) fall outside the video — check the video start timecode.`, 'info');
  } catch (e) {
    toast(`Screenshots stopped: ${(e as Error).message}`, 'error');
  } finally {
    video.removeAttribute('src');
    video.load();
    const cancelled = job.cancel;
    if (running === job) running = null;
    app.set({ capture: null });
    bumpBlobs();
    if (!cancelled) void syncShotNotes(p.id, version.id);
  }
}

/** Replace one item's screenshot with a specific frame. */
export async function captureAt(version: Version, item: Item, frame: number) {
  const s = app.get();
  const p = s.project;
  const url = s.videoUrls[version.id];
  if (!p || !url) return;
  const video = document.createElement('video');
  video.muted = true;
  video.src = url;
  try {
    await once(video, 'loadeddata', 15000);
    await seekTo(video, Math.max(0, frameToSeconds(frame, version, p.settings.defaultVideoStartTC)), 8000);
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = Math.round((THUMB_W * (video.videoHeight || 9)) / (video.videoWidth || 16));
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    if (blob) {
      await store.putBlob(blobKeys.shot(p.id, version.id, item.id), blob);
      const hash = await hashBlob(blob);
      updateProject((proj) => {
        for (const e of proj.episodes)
          for (const v of e.versions) {
            if (v.id !== version.id) continue;
            for (const list of Object.values(v.items)) {
              const it = list.find((i) => i.id === item.id);
              if (!it) continue;
              if (hash && it.shotHash !== hash) delete it.shotCompared;
              it.capturedFrame = frame;
              if (hash) it.shotHash = hash;
            }
          }
      });
      void syncShotNotes(p.id, version.id);
    }
    bumpBlobs();
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

/** Seek, and ignore a seeked event that belongs to an earlier time. */
async function seekTo(video: HTMLVideoElement, time: number, timeout: number) {
  const dur = Number.isFinite(video.duration) ? video.duration : time;
  const target = Math.min(Math.max(0, time), Math.max(0, dur - 0.001));
  if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.04) return;
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error('video did not respond (seeked)'));
    }, timeout);
    const ok = () => {
      if (Math.abs(video.currentTime - target) > 0.25) return;
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error('this video format cannot be decoded by the browser'));
    };
    const cleanup = () => {
      clearTimeout(t);
      video.removeEventListener('seeked', ok);
      video.removeEventListener('error', bad);
    };
    video.addEventListener('seeked', ok);
    video.addEventListener('error', bad);
    video.currentTime = target;
  });
}

let syncing = false;

/** Hash screenshots that don't have one yet, then copy blank notes from a matching picture. */
async function syncShotNotes(projectId: string, versionId: string) {
  if (syncing) return;
  const p = app.get().project;
  if (!p || p.id !== projectId) return;
  const ep = p.episodes.find((e) => e.versions.some((v) => v.id === versionId));
  if (!ep) return;
  syncing = true;
  const found: { versionId: string; catKey: string; itemId: string; hash: string }[] = [];
  try {
    for (const v of ep.versions) {
      for (const cat of p.categories) {
        if (!cat.columns.some((c) => c.auto === 'screenshot')) continue;
        for (const it of v.items[cat.key] ?? []) {
          if (it.shotHash || it.kind !== 'video') continue;
          const blob = await store.getBlob(blobKeys.shot(p.id, v.id, it.id));
          if (!blob) continue;
          const hash = await hashBlob(blob);
          if (hash) found.push({ versionId: v.id, catKey: cat.key, itemId: it.id, hash });
        }
      }
    }
    const filled = applyShotHashes(versionId, found);
    if (filled > 0) toast(`Copied notes onto ${filled} item${filled === 1 ? '' : 's'} whose picture matches the previous version.`);
  } catch {
    /* a missing or undecodable picture just leaves the row blank */
  } finally {
    syncing = false;
  }
}

async function hashBlob(blob: Blob): Promise<string | undefined> {
  if (typeof createImageBitmap !== 'function') return undefined;
  try {
    const bmp = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return undefined;
      ctx.drawImage(bmp, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return averageHash(img.data, img.width, img.height);
    } finally {
      bmp.close?.();
    }
  } catch {
    return undefined;
  }
}

function once(el: HTMLMediaElement, ev: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error(`video did not respond (${ev})`));
    }, timeout);
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error('this video format cannot be decoded by the browser'));
    };
    const cleanup = () => {
      clearTimeout(t);
      el.removeEventListener(ev, ok);
      el.removeEventListener('error', bad);
    };
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}
