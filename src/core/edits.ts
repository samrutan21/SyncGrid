import type { Item } from './types';

export interface DismissedCut {
  groupKey: string;
  recIn: number;
  recOut: number;
}

/** True when an imported cut is the one the user already removed. */
export function isDismissed(item: { groupKey: string; recIn: number; recOut: number }, gone: readonly DismissedCut[]): boolean {
  return gone.some((g) => g.groupKey === item.groupKey && item.recIn < g.recOut && g.recIn < item.recOut);
}

/**
 * Move one edge of an entry. Returns 'invalid' when the new edge would flip
 * the range, 'same' when nothing changed.
 */
export function moveEdge(item: Item, which: 'in' | 'out', frame: number): 'ok' | 'invalid' | 'same' {
  if (!Number.isFinite(frame)) return 'invalid';
  frame = Math.round(frame);
  const shift = { in: item.shift?.in ?? 0, out: item.shift?.out ?? 0 };
  if (which === 'in') {
    if (frame >= item.recOut) return 'invalid';
    if (frame === item.recIn) return 'same';
    shift.in += frame - item.recIn;
    item.recIn = frame;
  } else {
    if (frame <= item.recIn) return 'invalid';
    if (frame === item.recOut) return 'same';
    shift.out += frame - item.recOut;
    item.recOut = frame;
  }
  if (!item.manual) item.shift = shift;
  if (item.segments.length) {
    if (which === 'in') item.segments[0].recIn = item.recIn;
    else item.segments[item.segments.length - 1].recOut = item.recOut;
  }
  // The automatic picture is the middle of the new range, so the old file is stale.
  if (item.shotFrame === undefined) item.capturedFrame = undefined;
  return 'ok';
}
