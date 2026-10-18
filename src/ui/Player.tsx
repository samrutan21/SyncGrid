import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { fps, framesToTC, tcToFrames } from '../core/timecode';
import type { Item, Version } from '../core/types';
import { frameToSeconds, secondsToFrame } from '../media/screenshots';
import { app, pickVideo, playback, reconnectVideo, select, supportsFileHandles } from '../state/app';
import { useStore } from '../state/createStore';
import { Button, cssVars, Icon } from './common';
import { StartTCField } from './StartTCField';
import { useProject, useVersion } from './hooks';

/* ------------------------------------------------------------------ */
/* Player controller: lets panels/playbar seek without prop drilling   */
/* ------------------------------------------------------------------ */

export const player = {
  seek: (_frame: number) => {},
  toggle: () => {},
  step: (_frames: number) => {},
};

export function seekToItem(cat: string, item: Item) {
  select(cat, item.id);
  player.seek(item.recIn);
}

/* ------------------------------------------------------------------ */

export function Player() {
  const project = useProject();
  const version = useVersion();
  const url = useStore(app, (s) => (version ? s.videoUrls[version.id] : undefined));
  const videoRef = useRef<HTMLVideoElement>(null);
  const frame = useStore(playback, (s) => s.frame);
  const playing = useStore(playback, (s) => s.playing);
  const defaultStart = project?.settings.defaultVideoStartTC ?? '00:00:00:00';
  const [error, setError] = useState<string | null>(null);

  // Wire the controller to this video element.
  useEffect(() => {
    if (!version) return;
    const v = videoRef.current;
    const rate = version.rate;
    player.seek = (f: number) => {
      playback.set({ frame: f });
      if (v && url) v.currentTime = Math.max(0, frameToSeconds(f, version, defaultStart) + 0.5 / fps(rate));
    };
    player.toggle = () => {
      if (!v || !url) return;
      if (v.paused) void v.play();
      else v.pause();
    };
    player.step = (n: number) => {
      if (v && url) {
        v.pause();
        player.seek(secondsToFrame(v.currentTime, version, defaultStart) + n);
      } else {
        playback.set((s) => ({ frame: s.frame + n }));
      }
    };
  }, [version, url, defaultStart]);

  // Keep the playhead in sync while playing (rAF for smooth TC).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !version) return;
    let raf = 0;
    const tick = () => {
      playback.set({ frame: secondsToFrame(v.currentTime, version, defaultStart) });
      if (!v.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      playback.set({ playing: true });
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      playback.set({ playing: false });
      cancelAnimationFrame(raf);
      tick();
    };
    const onMeta = () => {
      playback.set({ durationSec: v.duration });
      setError(null);
    };
    const onErr = () => setError('This file can’t be played in the browser. Use an H.264 MP4 (ProRes and DNx won’t play in Chrome).');
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', tick);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('error', onErr);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', tick);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('error', onErr);
    };
  }, [version, url, defaultStart]);

  // Keep the current frame when switching versions with the same picture start.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !url || !version) return;
    const f = playback.get().frame;
    const onLoad = () => {
      v.currentTime = Math.max(0, frameToSeconds(f, version, defaultStart));
    };
    v.addEventListener('loadedmetadata', onLoad, { once: true });
    return () => v.removeEventListener('loadedmetadata', onLoad);
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Park the playhead at picture start when a version opens without video.
  useEffect(() => {
    if (!version || url) return;
    const pic = tcToFrames(project?.settings.pictureStartTC ?? '01:00:00:00', version.rate.timebase);
    const f = playback.get().frame;
    if (f === 0 && !Number.isNaN(pic)) playback.set({ frame: pic });
  }, [version?.id, url]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project || !version) return null;
  const timebase = version.rate.timebase;
  const tc = framesToTC(frame, timebase);
  const startTC = version.video?.startTC || defaultStart;

  return (
    <section className="player">
      <div className="viewer">
        {url ? (
          <video
            ref={videoRef}
            src={url}
            className="video"
            playsInline
            preload="auto"
            onClick={() => player.toggle()}
          />
        ) : (
          <VideoPlaceholder version={version} />
        )}
        {error && url && <div className="viewer-error">{error}</div>}
      </div>
      <div className="transport">
        <div className="transport-left">
          <button className="icon-btn" onClick={() => player.step(-1)} title="Back 1 frame (←)" aria-label="Back one frame">
            <Icon name="stepBack" />
          </button>
          <button className="icon-btn play" onClick={() => player.toggle()} disabled={!url} title="Play / pause (Space)" aria-label="Play or pause">
            <Icon name={playing ? 'pause' : 'play'} size={18} />
          </button>
          <button className="icon-btn" onClick={() => player.step(1)} title="Forward 1 frame (→)" aria-label="Forward one frame">
            <Icon name="stepFwd" />
          </button>
          <span className="tc-display" title="Sequence timecode">
            {tc}
          </span>
        </div>
        <div className="transport-right">
          <StartTCField
            compact
            versionId={version.id}
            value={startTC}
            detected={version.video?.detectedStartTC}
            from={version.video?.detectedFrom}
          />
          {url && (
            <Button small variant="ghost" icon="film" onClick={() => void pickVideo(version.id)} title="Load a different video file">
              {version.video?.fileName || 'Video'}
            </Button>
          )}
        </div>
      </div>
      <Playbar version={version} />
    </section>
  );
}

function VideoPlaceholder({ version }: { version: Version }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const remembered = version.video?.hasHandle && version.video.fileName;
  const choose = () => {
    if (supportsFileHandles()) void pickVideo(version.id);
    else input.current?.click();
  };
  return (
    <div className="viewer-empty">
      <Icon name="film" size={34} />
      {remembered ? (
        <>
          <p>
            <strong>{version.video!.fileName}</strong>
          </p>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await reconnectVideo(version.id);
              setBusy(false);
              if (!ok) choose();
            }}
          >
            Reconnect video
          </Button>
          <p className="muted small">Chrome asks once per session before reopening a local file.</p>
        </>
      ) : (
        <>
          <p>Load the offline for this version to see markers on picture.</p>
          <Button variant="primary" icon="film" onClick={choose}>
            Load video
          </Button>
          <p className="muted small">H.264 MP4 · plays from your drive, nothing is uploaded</p>
        </>
      )}
      <input
        ref={input}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void pickVideo(version.id, f);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Playbar with one marker lane per visible category                   */
/* ------------------------------------------------------------------ */

export function Playbar({ version }: { version: Version }) {
  const project = useProject()!;
  const enabled = useStore(app, (s) => s.enabled);
  const selected = useStore(app, (s) => s.selected);
  const durationSec = useStore(playback, (s) => s.durationSec);
  const url = useStore(app, (s) => s.videoUrls[version.id]);
  const frame = useStore(playback, (s) => s.frame);
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; text: string } | null>(null);
  const timebase = version.rate.timebase;

  const cats = project.categories.filter((c) => enabled.includes(c.key));
  const range = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of project.categories) {
      for (const it of version.items[c.key] ?? []) {
        lo = Math.min(lo, it.recIn);
        hi = Math.max(hi, it.recOut);
      }
    }
    const picStart = tcToFrames(project.settings.pictureStartTC, timebase);
    const start = tcToFrames(version.video?.startTC || project.settings.defaultVideoStartTC, timebase);
    const hasVideo = !!(url && durationSec > 0 && !Number.isNaN(start));
    const videoEnd = hasVideo ? start + Math.round(durationSec * fps(version.rate)) : null;
    // The file is one span on the timeline. Markers that fall outside it stay visible.
    if (hasVideo && videoEnd !== null) {
      lo = Math.min(lo, start);
      hi = Math.max(hi, videoEnd);
    }
    if (!Number.isFinite(lo)) {
      lo = Number.isNaN(picStart) ? 0 : picStart;
      hi = lo + timebase * 60 * 30;
    }
    if (!hasVideo && version.seqStartFrame !== null) lo = Math.min(lo, version.seqStartFrame);
    const pad = hasVideo && videoEnd !== null && hi <= videoEnd ? 0 : timebase * 2;
    return { lo, hi: hi + pad };
  }, [project, version, url, durationSec, timebase]);

  const span = Math.max(1, range.hi - range.lo);
  const pct = (f: number) => ((f - range.lo) / span) * 100;
  const frameAt = useCallback(
    (clientX: number) => {
      const r = track.current!.getBoundingClientRect();
      return Math.round(range.lo + ((clientX - r.left) / r.width) * span);
    },
    [range, span],
  );

  const scrub = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('.marker')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    player.seek(frameAt(e.clientX));
  };
  const picStart = tcToFrames(project.settings.pictureStartTC, timebase);

  return (
    <div className="playbar">
      <div
        className="playbar-track"
        ref={track}
        onPointerDown={scrub}
        onPointerMove={(e) => {
          if (e.buttons === 1 && !(e.target as HTMLElement).closest('.marker')) player.seek(frameAt(e.clientX));
          const r = track.current!.getBoundingClientRect();
          if (!(e.target as HTMLElement).closest('.marker'))
            setHover({ x: e.clientX - r.left, text: framesToTC(frameAt(e.clientX), timebase) });
        }}
        onPointerLeave={() => setHover(null)}
      >
        <div className="playbar-ruler">
          <div className="playbar-progress" style={{ width: `${Math.min(100, Math.max(0, pct(frame)))}%` }} />
          {!Number.isNaN(picStart) && picStart > range.lo && picStart < range.hi && (
            <div className="ffoa" style={{ left: `${pct(picStart)}%` }} title={`Picture start ${project.settings.pictureStartTC}`} />
          )}
        </div>
        {cats.map((c) => (
          <div className="lane" key={c.key} title={c.label}>
            {(version.items[c.key] ?? []).map((it) => {
              const left = pct(it.recIn);
              const width = Math.max(0.15, pct(it.recOut) - left);
              const isSel = selected?.id === it.id;
              return (
                <button
                  key={it.id}
                  className={`marker ${isSel ? 'is-selected' : ''} ${it.kind === 'audio' ? 'is-audio' : ''}`}
                  style={cssVars({ left: `${left}%`, width: `${width}%`, '--c': c.color })}
                  onClick={() => seekToItem(c.key, it)}
                  onPointerEnter={(e) => {
                    const r = track.current!.getBoundingClientRect();
                    setHover({
                      x: e.clientX - r.left,
                      text: `${c.label} · ${framesToTC(it.recIn, timebase)} · ${it.auto.cueTitle || it.auto.archivalId || it.name}`,
                    });
                  }}
                  aria-label={`${c.label} ${it.name} at ${framesToTC(it.recIn, timebase)}`}
                />
              );
            })}
          </div>
        ))}
        <div className="playhead" style={{ left: `${Math.min(100, Math.max(0, pct(frame)))}%` }} />
        {hover && (
          <div className="playbar-tip" style={{ left: hover.x }}>
            {hover.text}
          </div>
        )}
      </div>
      <div className="playbar-scale">
        <span>{framesToTC(range.lo, timebase)}</span>
        <span>{framesToTC(range.hi, timebase)}</span>
      </div>
    </div>
  );
}
