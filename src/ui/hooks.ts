import { useEffect, useMemo, useState } from 'react';
import { diffItems, type VersionDiff } from '../core/diff';
import { findRepeats, type RepeatInfo } from '../core/pipeline';
import type { CategoryConfig, Version } from '../core/types';
import { app, compareVersion, currentVersion } from '../state/app';
import { useStore } from '../state/createStore';
import { store } from '../storage/store';

/* Blob → object URL with a small cache, refreshed whenever blobs change. */
const urlCache = new Map<string, { rev: number; url: string | null }>();

export function useBlobUrl(key: string | undefined): string | null {
  const rev = useStore(app, (s) => s.blobRev);
  const cached = key ? urlCache.get(key) : undefined;
  const [url, setUrl] = useState<string | null>(cached?.url ?? null);
  useEffect(() => {
    let alive = true;
    if (!key) {
      setUrl(null);
      return;
    }
    const hit = urlCache.get(key);
    if (hit && hit.rev === rev) {
      setUrl(hit.url);
      return;
    }
    store.getBlob(key).then((b) => {
      const prev = urlCache.get(key);
      if (prev?.url) URL.revokeObjectURL(prev.url);
      const u = b ? URL.createObjectURL(b) : null;
      urlCache.set(key, { rev, url: u });
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [key, rev]);
  return url;
}

export function useProject() {
  return useStore(app, (s) => s.project);
}

export function useVersion(): Version | undefined {
  useStore(app, (s) => s.project);
  useStore(app, (s) => s.versionId);
  useStore(app, (s) => s.episodeId);
  return currentVersion();
}

export function useCompare(): Version | undefined {
  useStore(app, (s) => s.project);
  useStore(app, (s) => s.versionId);
  useStore(app, (s) => s.compareId);
  return compareVersion();
}

/** Change report for one category: current version vs baseline. */
export function useDiff(cat: CategoryConfig): VersionDiff | null {
  const v = useVersion();
  const base = useCompare();
  const items = v?.items[cat.key];
  const prev = base?.items[cat.key];
  return useMemo(() => (items && prev ? diffItems(prev, items, v!.rate.timebase) : null), [items, prev, v]);
}

export function useRepeats(cat: CategoryConfig): Map<string, RepeatInfo> {
  const v = useVersion();
  const minSec = useStore(app, (s) => s.project?.settings.archivalRepeatMinSeconds ?? 1);
  const items = v?.items[cat.key];
  return useMemo(() => (items ? findRepeats(items, cat, minSec) : new Map()), [items, cat, minSec]);
}
