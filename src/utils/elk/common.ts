import type { Layout, Point, RoutedEdge } from "../../types";
import { LAYOUT_PADDING } from "../schemaParser";

export type Side = "EAST" | "WEST" | "NORTH" | "SOUTH";

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function oppositeSide(s: Side): Side {
  if (s === "EAST") return "WEST";
  if (s === "WEST") return "EAST";
  if (s === "NORTH") return "SOUTH";
  return "NORTH";
}

function removeConsecutiveDuplicates(points: Point[]) {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

export function simplifyOrthogonal(points: Point[]) {
  let pts = removeConsecutiveDuplicates(points);
  if (pts.length <= 2) return pts;

  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];

    const collinearX = a.x === b.x && b.x === c.x;
    const collinearY = a.y === b.y && b.y === c.y;

    if (collinearX || collinearY) continue;
    out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return removeConsecutiveDuplicates(out);
}

export function extendLeadWithoutExtraBends(
  points: Point[],
  which: "start" | "end",
  minLead: number,
) {
  if (points.length < 2) return points;

  const out = points.map((p) => ({ ...p }));

  if (which === "start") {
    const a = out[0];
    const b = out[1];

    if (a.y === b.y) {
      const dir = Math.sign(b.x - a.x);
      const len = Math.abs(b.x - a.x);
      if (dir !== 0 && len < minLead) {
        const oldX = b.x;
        const newX = a.x + dir * minLead;
        out[1].x = newX;
        for (let i = 2; i < out.length; i++) {
          if (out[i].x !== oldX) break;
          out[i].x = newX;
        }
        return simplifyOrthogonal(out);
      }
    }

    if (a.x === b.x) {
      const dir = Math.sign(b.y - a.y);
      const len = Math.abs(b.y - a.y);
      if (dir !== 0 && len < minLead) {
        const oldY = b.y;
        const newY = a.y + dir * minLead;
        out[1].y = newY;
        for (let i = 2; i < out.length; i++) {
          if (out[i].y !== oldY) break;
          out[i].y = newY;
        }
        return simplifyOrthogonal(out);
      }
    }

    return points;
  }

  const a = out[out.length - 2];
  const b = out[out.length - 1];

  if (a.y === b.y) {
    const dir = Math.sign(b.x - a.x);
    const len = Math.abs(b.x - a.x);
    if (dir !== 0 && len < minLead) {
      const oldX = a.x;
      const newX = b.x - dir * minLead;
      out[out.length - 2].x = newX;
      for (let i = out.length - 3; i >= 0; i--) {
        if (out[i].x !== oldX) break;
        out[i].x = newX;
      }
      return simplifyOrthogonal(out);
    }
  }

  if (a.x === b.x) {
    const dir = Math.sign(b.y - a.y);
    const len = Math.abs(b.y - a.y);
    if (dir !== 0 && len < minLead) {
      const oldY = a.y;
      const newY = b.y - dir * minLead;
      out[out.length - 2].y = newY;
      for (let i = out.length - 3; i >= 0; i--) {
        if (out[i].y !== oldY) break;
        out[i].y = newY;
      }
      return simplifyOrthogonal(out);
    }
  }

  return points;
}

export function ensureMinEndpointLegs(points: Point[], minLeg: number) {
  if (points.length < 2) return points;
  const out = points.map((p) => ({ ...p }));

  const s0 = out[0];
  const s1 = out[1];
  if (s0.x === s1.x) {
    const dir = Math.sign(s1.y - s0.y);
    const len = Math.abs(s1.y - s0.y);
    if (dir !== 0 && len < minLeg) {
      const oldY = s1.y;
      const newY = s0.y + dir * minLeg;
      out[1].y = newY;
      for (let i = 2; i < out.length; i++) {
        if (out[i].y !== oldY) break;
        out[i].y = newY;
      }
    }
  } else if (s0.y === s1.y) {
    const dir = Math.sign(s1.x - s0.x);
    const len = Math.abs(s1.x - s0.x);
    if (dir !== 0 && len < minLeg) {
      const oldX = s1.x;
      const newX = s0.x + dir * minLeg;
      out[1].x = newX;
      for (let i = 2; i < out.length; i++) {
        if (out[i].x !== oldX) break;
        out[i].x = newX;
      }
    }
  }

  const n = out.length;
  const e0 = out[n - 2];
  const e1 = out[n - 1];

  if (e0.x === e1.x) {
    const dir = Math.sign(e1.y - e0.y);
    const len = Math.abs(e1.y - e0.y);
    if (dir !== 0 && len < minLeg) {
      const oldY = e0.y;
      const newY = e1.y - dir * minLeg;
      out[n - 2].y = newY;
      for (let i = n - 3; i >= 0; i--) {
        if (out[i].y !== oldY) break;
        out[i].y = newY;
      }
    }
  } else if (e0.y === e1.y) {
    const dir = Math.sign(e1.x - e0.x);
    const len = Math.abs(e1.x - e0.x);
    if (dir !== 0 && len < minLeg) {
      const oldX = e0.x;
      const newX = e1.x - dir * minLeg;
      out[n - 2].x = newX;
      for (let i = n - 3; i >= 0; i--) {
        if (out[i].x !== oldX) break;
        out[i].x = newX;
      }
    }
  }

  return simplifyOrthogonal(out);
}

export function pointsFromElkEdge(e: any): Point[] | null {
  const sections = e.sections ?? [];
  if (!sections.length) return null;

  const out: Point[] = [];

  for (const sec of sections) {
    if (!sec?.startPoint || !sec?.endPoint) continue;

    const pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map(
      (p: any) => ({ x: p.x, y: p.y }),
    ) as Point[];

    if (!pts.length) continue;

    if (out.length) {
      const last = out[out.length - 1];
      const first = pts[0];
      if (last.x === first.x && last.y === first.y) out.push(...pts.slice(1));
      else out.push(...pts);
    } else {
      out.push(...pts);
    }
  }

  return out.length ? simplifyOrthogonal(out) : null;
}

export function normalizeWithPadding(
  layout: Record<string, Layout>,
  edges: RoutedEdge[],
) {
  let minX = Infinity;
  let minY = Infinity;

  for (const b of Object.values(layout)) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
  }
  for (const ed of edges) {
    for (const p of ed.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
    }
  }

  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(minY)) minY = 0;

  const shiftX = LAYOUT_PADDING - minX;
  const shiftY = LAYOUT_PADDING - minY;

  for (const k of Object.keys(layout)) {
    layout[k] = {
      ...layout[k],
      x: layout[k].x + shiftX,
      y: layout[k].y + shiftY,
    };
  }
  for (const ed of edges) {
    ed.points = ed.points.map((p) => ({ x: p.x + shiftX, y: p.y + shiftY }));
  }

  let maxX = 0;
  let maxY = 0;

  for (const b of Object.values(layout)) {
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  for (const ed of edges) {
    for (const p of ed.points) {
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  return {
    width: Math.ceil(maxX + LAYOUT_PADDING),
    height: Math.ceil(maxY + LAYOUT_PADDING),
  };
}

export function nudgeToMinGap(
  bases: number[],
  min: number,
  max: number,
  minGap: number,
) {
  const n = bases.length;
  if (n === 0) return [];

  const placed = bases.map((b) => clamp(b, min, max));

  for (let i = 1; i < n; i++) {
    if (placed[i] - placed[i - 1] < minGap) placed[i] = placed[i - 1] + minGap;
  }

  const overflow = placed[n - 1] - max;
  if (overflow > 0) for (let i = 0; i < n; i++) placed[i] -= overflow;

  for (let i = n - 2; i >= 0; i--) {
    if (placed[i + 1] - placed[i] < minGap) placed[i] = placed[i + 1] - minGap;
  }

  const underflow = min - placed[0];
  if (underflow > 0) for (let i = 0; i < n; i++) placed[i] += underflow;

  return placed.map((p) => clamp(p, min, max));
}
