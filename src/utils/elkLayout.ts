import ELK from "elkjs/lib/elk.bundled.js";
import type { Layout, Relation, RoutedEdge, Table, Point } from "../types";
import {
  getTableHeight,
  TABLE_HEADER_HEIGHT,
  TABLE_ROW_HEIGHT,
  TABLE_WIDTH,
  LAYOUT_PADDING,
} from "./schemaParser";

type BuildElkResult = {
  layout: Record<string, Layout>;
  edges: RoutedEdge[];
  size: { width: number; height: number };
};

type Side = "EAST" | "WEST" | "NORTH" | "SOUTH";
const SIDES: Side[] = ["EAST", "WEST", "NORTH", "SOUTH"];

// Ports are only routing anchors; keep tiny
const PORT_SIZE = 2;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function removeConsecutiveDuplicates(points: Point[]) {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

function simplifyOrthogonal(points: Point[]) {
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

function oppositeSide(s: Side): Side {
  if (s === "EAST") return "WEST";
  if (s === "WEST") return "EAST";
  if (s === "NORTH") return "SOUTH";
  return "NORTH";
}

function sideNormal(s: Side): Point {
  if (s === "EAST") return { x: 1, y: 0 };
  if (s === "WEST") return { x: -1, y: 0 };
  if (s === "SOUTH") return { x: 0, y: 1 };
  return { x: 0, y: -1 };
}

/**
 * Fan edges outward near the endpoint so they don't stack/collide right at the table border.
 * Only applied when multiple edges share the same side of the same table.
 */
function addEndpointFan(
  points: Point[],
  side: Side,
  laneIndex: number,
  laneCount: number,
  which: "start" | "end",
) {
  if (points.length < 2) return points;
  if (laneCount <= 1) return points;

  const lane = laneIndex - (laneCount - 1) / 2;

  const BASE = 26;
  const STEP = 14;
  const dist = clamp(BASE + lane * STEP, 18, 78);

  const norm = sideNormal(side);

  if (which === "start") {
    const start = points[0];
    const next = points[1];

    if (norm.x !== 0) {
      const fx = start.x + norm.x * dist;
      return simplifyOrthogonal([
        start,
        { x: fx, y: start.y },
        { x: fx, y: next.y },
        ...points.slice(1),
      ]);
    } else {
      const fy = start.y + norm.y * dist;
      return simplifyOrthogonal([
        start,
        { x: start.x, y: fy },
        { x: next.x, y: fy },
        ...points.slice(1),
      ]);
    }
  } else {
    const prev = points[points.length - 2];
    const end = points[points.length - 1];

    if (norm.x !== 0) {
      const fx = end.x + norm.x * dist;
      return simplifyOrthogonal([
        ...points.slice(0, -1),
        { x: fx, y: prev.y },
        { x: fx, y: end.y },
        end,
      ]);
    } else {
      const fy = end.y + norm.y * dist;
      return simplifyOrthogonal([
        ...points.slice(0, -1),
        { x: prev.x, y: fy },
        { x: end.x, y: fy },
        end,
      ]);
    }
  }
}

/**
 * If ELK produces tiny first/last segments ("stubby" leads), add a clean outward stub
 * without creating backtracking.
 */
function ensureMinLead(
  points: Point[],
  side: Side,
  which: "start" | "end",
  minLead: number,
) {
  if (points.length < 2) return points;

  const norm = sideNormal(side);

  if (which === "start") {
    const a = points[0];
    const b = points[1];

    // horizontal outward lead
    if (
      norm.x !== 0 &&
      a.y === b.y &&
      Math.sign(b.x - a.x) === Math.sign(norm.x)
    ) {
      const len = Math.abs(b.x - a.x);
      if (len >= minLead) return points;

      const stubX = a.x + norm.x * minLead;

      // If we have a bend point (a->b->c), use c's coordinate to rejoin orthogonally.
      if (points.length >= 3) {
        const c = points[2];
        return simplifyOrthogonal([
          a,
          { x: stubX, y: a.y },
          { x: stubX, y: c.y },
          ...points.slice(2),
        ]);
      }

      return simplifyOrthogonal([a, { x: stubX, y: a.y }, b]);
    }

    // vertical outward lead
    if (
      norm.y !== 0 &&
      a.x === b.x &&
      Math.sign(b.y - a.y) === Math.sign(norm.y)
    ) {
      const len = Math.abs(b.y - a.y);
      if (len >= minLead) return points;

      const stubY = a.y + norm.y * minLead;

      if (points.length >= 3) {
        const c = points[2];
        return simplifyOrthogonal([
          a,
          { x: a.x, y: stubY },
          { x: c.x, y: stubY },
          ...points.slice(2),
        ]);
      }

      return simplifyOrthogonal([a, { x: a.x, y: stubY }, b]);
    }

    return points;
  } else {
    const a = points[points.length - 2];
    const b = points[points.length - 1];

    // last segment approaches the port from the outward direction (so b->a is along normal)
    if (
      norm.x !== 0 &&
      a.y === b.y &&
      Math.sign(a.x - b.x) === Math.sign(norm.x)
    ) {
      const len = Math.abs(a.x - b.x);
      if (len >= minLead) return points;

      const stubX = b.x + norm.x * minLead;

      if (points.length >= 3) {
        const prev = points[points.length - 3];
        return simplifyOrthogonal([
          ...points.slice(0, -2),
          { x: stubX, y: prev.y },
          { x: stubX, y: b.y },
          b,
        ]);
      }

      return simplifyOrthogonal([a, { x: stubX, y: b.y }, b]);
    }

    if (
      norm.y !== 0 &&
      a.x === b.x &&
      Math.sign(a.y - b.y) === Math.sign(norm.y)
    ) {
      const len = Math.abs(a.y - b.y);
      if (len >= minLead) return points;

      const stubY = b.y + norm.y * minLead;

      if (points.length >= 3) {
        const prev = points[points.length - 3];
        return simplifyOrthogonal([
          ...points.slice(0, -2),
          { x: prev.x, y: stubY },
          { x: b.x, y: stubY },
          b,
        ]);
      }

      return simplifyOrthogonal([a, { x: b.x, y: stubY }, b]);
    }

    return points;
  }
}

function getColumnCenterY(table: Table, columnName: string) {
  const idx = table.columns.findIndex((c) => c.name === columnName);
  const safe = idx >= 0 ? idx : 0;
  return TABLE_HEADER_HEIGHT + safe * TABLE_ROW_HEIGHT + TABLE_ROW_HEIGHT / 2;
}

/**
 * Ports should represent "this column row" visually.
 * That only really maps to EAST/WEST sides (y coordinate).
 * For NORTH/SOUTH, use centered x to avoid fake "column x".
 */
function baseAlongForSide(table: Table, side: Side, columnName: string) {
  if (side === "EAST" || side === "WEST")
    return getColumnCenterY(table, columnName);
  return TABLE_WIDTH / 2;
}

function portCenterForSide(
  table: Table,
  side: Side,
  columnName: string,
): Point {
  const h = getTableHeight(table);
  if (side === "EAST")
    return { x: TABLE_WIDTH, y: getColumnCenterY(table, columnName) };
  if (side === "WEST") return { x: 0, y: getColumnCenterY(table, columnName) };
  if (side === "SOUTH") return { x: TABLE_WIDTH / 2, y: h };
  return { x: TABLE_WIDTH / 2, y: 0 };
}

/**
 * Minimal-nudge placement:
 * - start at bases (clamped)
 * - only move items when they collide (< minGap)
 * - then shift the whole set back into [min,max] if needed
 */
function nudgeToMinGap(
  bases: number[],
  min: number,
  max: number,
  minGap: number,
) {
  const n = bases.length;
  if (n === 0) return [];

  const placed = bases.map((b) => clamp(b, min, max));

  // forward
  for (let i = 1; i < n; i++) {
    if (placed[i] - placed[i - 1] < minGap) placed[i] = placed[i - 1] + minGap;
  }

  // shift down if overflow
  const overflow = placed[n - 1] - max;
  if (overflow > 0) for (let i = 0; i < n; i++) placed[i] -= overflow;

  // backward
  for (let i = n - 2; i >= 0; i--) {
    if (placed[i + 1] - placed[i] < minGap) placed[i] = placed[i + 1] - minGap;
  }

  // shift up if underflow
  const underflow = min - placed[0];
  if (underflow > 0) for (let i = 0; i < n; i++) placed[i] += underflow;

  return placed.map((p) => clamp(p, min, max));
}

/**
 * Choose child port side by cost:
 * - prefer sides facing the parent
 * - slight penalty for N/S (doesn't map to a specific column row)
 */
function chooseChildSideByCost(args: {
  child: Table;
  parent: Table;
  childBox: { x: number; y: number; w: number; h: number };
  parentBox: { x: number; y: number; w: number; h: number };
  childColumn: string;
  parentColumn: string;
}): Side {
  const { child, parent, childBox, parentBox, childColumn, parentColumn } =
    args;

  const childCenter = {
    x: childBox.x + childBox.w / 2,
    y: childBox.y + childBox.h / 2,
  };
  const parentCenter = {
    x: parentBox.x + parentBox.w / 2,
    y: parentBox.y + parentBox.h / 2,
  };

  const vec = {
    x: parentCenter.x - childCenter.x,
    y: parentCenter.y - childCenter.y,
  };
  const len = Math.hypot(vec.x, vec.y) || 1;

  let bestSide: Side = "WEST";
  let bestScore = Number.POSITIVE_INFINITY;

  for (const side of SIDES) {
    const parentSide = oppositeSide(side);

    const childPort = portCenterForSide(child, side, childColumn);
    const parentPort = portCenterForSide(parent, parentSide, parentColumn);

    const childWorld = {
      x: childBox.x + childPort.x,
      y: childBox.y + childPort.y,
    };
    const parentWorld = {
      x: parentBox.x + parentPort.x,
      y: parentBox.y + parentPort.y,
    };

    const manhattan =
      Math.abs(parentWorld.x - childWorld.x) +
      Math.abs(parentWorld.y - childWorld.y);

    const n = sideNormal(side);
    const dot = (vec.x * n.x + vec.y * n.y) / len; // [-1..1]
    const facingPenalty = dot < 0 ? 2500 : (1 - dot) * 220;

    const nsPenalty = side === "NORTH" || side === "SOUTH" ? 180 : 0;

    const score = manhattan + facingPenalty + nsPenalty;

    if (score < bestScore) {
      bestScore = score;
      bestSide = side;
    }
  }

  return bestSide;
}

function pointsFromElkEdge(e: any): Point[] | null {
  const sections = e.sections ?? [];
  if (!sections.length) return null;

  const out: Point[] = [];

  for (const sec of sections) {
    if (!sec?.startPoint || !sec?.endPoint) continue;

    const pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map(
      (p: any) => ({
        x: p.x,
        y: p.y,
      }),
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

export async function buildOptimalLayoutElk(
  tables: Table[],
  relations: Relation[],
  options?: { availableWidth?: number },
): Promise<BuildElkResult> {
  const elk = new ELK();
  const tableByName = new Map(tables.map((t) => [t.name, t]));

  const portMeta = new Map<
    string,
    { laneIndex: number; laneCount: number; side: Side }
  >();

  const availableWidth = Math.max(520, options?.availableWidth ?? 1200);
  const targetWrapWidth = Math.max(
    520,
    Math.floor((availableWidth - LAYOUT_PADDING * 2) * 0.98),
  );

  // --- PRE-LAYOUT (no ports) to get approximate boxes ---
  const preNodes = tables.map((t) => ({
    id: t.name,
    width: TABLE_WIDTH,
    height: getTableHeight(t),
  }));

  // Layout edges as PARENT -> CHILD (referenced -> referencing)
  const preEdges = relations
    .map((r, i) => {
      if (!tableByName.has(r.fromTable) || !tableByName.has(r.toTable))
        return null;
      return { id: `pre:${i}`, sources: [r.toTable], targets: [r.fromTable] };
    })
    .filter(Boolean);

  const preGraph: any = {
    id: "preRoot",
    children: preNodes,
    edges: preEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "POLYLINE",
      "elk.layered.unnecessaryBendpoints": "true",

      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,

      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "84",

      "elk.layered.wrapping.strategy": "SINGLE_EDGE",
      "elk.layered.wrapping.targetWidth": String(targetWrapWidth),

      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
      "elk.layered.cycleBreaking.strategy": "GREEDY",
    },
  };

  const preOut = await elk.layout(preGraph);

  const preBox = new Map<
    string,
    { x: number; y: number; w: number; h: number }
  >();
  for (const n of preOut.children ?? []) {
    preBox.set(n.id, {
      x: n.x ?? 0,
      y: n.y ?? 0,
      w: n.width ?? TABLE_WIDTH,
      h: n.height ?? 0,
    });
  }

  // --- Build ports based on relation endpoints ---
  type Endpoint = {
    relIndex: number;
    tableName: string;
    columnName: string;
    side: Side;
    portId: string;
    kind: "child" | "parent";
    baseAlong: number;
  };

  const endpoints: Endpoint[] = [];

  relations.forEach((r, i) => {
    const child = tableByName.get(r.fromTable);
    const parent = tableByName.get(r.toTable);
    const childB = preBox.get(r.fromTable);
    const parentB = preBox.get(r.toTable);
    if (!child || !parent || !childB || !parentB) return;
    if (r.fromTable === r.toTable) return;

    const childSide = chooseChildSideByCost({
      child,
      parent,
      childBox: childB,
      parentBox: parentB,
      childColumn: r.fromColumn,
      parentColumn: r.toColumn,
    });

    const parentSide = oppositeSide(childSide);

    endpoints.push({
      relIndex: i,
      tableName: r.fromTable,
      columnName: r.fromColumn,
      side: childSide,
      baseAlong: baseAlongForSide(child, childSide, r.fromColumn),
      portId: `port:child:${i}`,
      kind: "child",
    });

    endpoints.push({
      relIndex: i,
      tableName: r.toTable,
      columnName: r.toColumn,
      side: parentSide,
      baseAlong: baseAlongForSide(parent, parentSide, r.toColumn),
      portId: `port:parent:${i}`,
      kind: "parent",
    });
  });

  const endpointsByTableSide = new Map<string, Endpoint[]>();
  for (const ep of endpoints) {
    const k = `${ep.tableName}|${ep.side}`;
    if (!endpointsByTableSide.has(k)) endpointsByTableSide.set(k, []);
    endpointsByTableSide.get(k)!.push(ep);
  }

  // portId -> CENTER position within the node
  const portCenters = new Map<string, { x: number; y: number; side: Side }>();

  for (const [key, group] of endpointsByTableSide.entries()) {
    group.sort((a, b) => a.baseAlong - b.baseAlong || a.relIndex - b.relIndex);

    const [tableName, side] = key.split("|") as [string, Side];
    const t = tableByName.get(tableName);
    if (!t) continue;

    const h = getTableHeight(t);

    if (side === "EAST" || side === "WEST") {
      const minY = TABLE_HEADER_HEIGHT + TABLE_ROW_HEIGHT / 2;
      const maxY = h - TABLE_ROW_HEIGHT / 2;

      const bases = group.map((g) => g.baseAlong);
      const span = Math.max(0, maxY - minY);

      // Keep close to actual column row (reduces "unnecessary" bends),
      // but still separate arrowheads when multiple edges share a side.
      const minGap = clamp(Math.round(span / (group.length + 1)), 10, 16);

      // If all bases are identical (many refs to same PK row), seed symmetrically
      // by a small amount (not the full-table spread) so endpoints don't all shift one way.
      const baseMin = Math.min(...bases);
      const baseMax = Math.max(...bases);
      const baseRange = baseMax - baseMin;
      const seeded =
        group.length > 1 && baseRange < minGap * 0.25
          ? bases.map((b, i) => b + (i - (group.length - 1) / 2) * minGap)
          : bases;

      const ys = nudgeToMinGap(seeded, minY, maxY, minGap);

      const cx = side === "EAST" ? TABLE_WIDTH : 0;
      for (let i = 0; i < group.length; i++) {
        const ep = group[i];
        portCenters.set(ep.portId, { x: cx, y: ys[i], side });
        portMeta.set(ep.portId, {
          laneIndex: i,
          laneCount: group.length,
          side,
        });
      }
    } else {
      const minX = 18;
      const maxX = TABLE_WIDTH - 18;

      const bases = group.map((g) => g.baseAlong);
      const span = Math.max(0, maxX - minX);

      const minGap = clamp(Math.round(span / (group.length + 1)), 12, 20);

      const baseMin = Math.min(...bases);
      const baseMax = Math.max(...bases);
      const baseRange = baseMax - baseMin;
      const seeded =
        group.length > 1 && baseRange < minGap * 0.25
          ? bases.map((b, i) => b + (i - (group.length - 1) / 2) * minGap)
          : bases;

      const xs = nudgeToMinGap(seeded, minX, maxX, minGap);

      const cy = side === "SOUTH" ? h : 0;
      for (let i = 0; i < group.length; i++) {
        const ep = group[i];
        portCenters.set(ep.portId, { x: xs[i], y: cy, side });
        portMeta.set(ep.portId, {
          laneIndex: i,
          laneCount: group.length,
          side,
        });
      }
    }
  }

  // Degree-based margin (avoid huge margins; they often create long detours)
  const degree = new Map<string, number>();
  for (const t of tables) degree.set(t.name, 0);
  for (const r of relations) {
    degree.set(r.fromTable, (degree.get(r.fromTable) ?? 0) + 1);
    degree.set(r.toTable, (degree.get(r.toTable) ?? 0) + 1);
  }

  const elkNodes = tables.map((t) => {
    const d = degree.get(t.name) ?? 0;
    const margin = d >= 10 ? 34 : d >= 6 ? 26 : 18;

    const ports = endpoints
      .filter((ep) => ep.tableName === t.name)
      .map((ep) => {
        const c = portCenters.get(ep.portId);
        if (!c) return null;

        // ELK expects port (x,y) as top-left
        return {
          id: ep.portId,
          width: PORT_SIZE,
          height: PORT_SIZE,
          x: c.x - PORT_SIZE / 2,
          y: c.y - PORT_SIZE / 2,
          layoutOptions: { "elk.port.side": c.side },
        };
      })
      .filter(Boolean);

    return {
      id: t.name,
      width: TABLE_WIDTH,
      height: getTableHeight(t),
      ports,
      layoutOptions: {
        "elk.portConstraints": "FIXED_POS",
        "elk.margin": `[top=${margin},left=${margin},bottom=${margin},right=${margin}]`,
      },
    };
  });

  // ELK edges are PARENT -> CHILD for better layered placement + routing.
  const elkEdges = relations
    .map((r, i) => {
      if (!tableByName.has(r.fromTable) || !tableByName.has(r.toTable))
        return null;
      return {
        id: `edge:${i}`,
        sources: [`port:parent:${i}`],
        targets: [`port:child:${i}`],
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    sources: string[];
    targets: string[];
  }>;

  const graph: any = {
    id: "root",
    children: elkNodes,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.unnecessaryBendpoints": "true",

      // Helps avoid tiny "stubby" first/last segments
      "elk.orthogonalRouting.minimumSegmentLength": "26",

      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,

      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "86",

      "elk.spacing.edgeEdge": "14",
      "elk.spacing.edgeNode": "22",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "16",

      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
      "elk.layered.cycleBreaking.strategy": "GREEDY",

      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.layered.nodePlacement.favorStraightEdges": "true",

      "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",

      "elk.layered.wrapping.strategy": "SINGLE_EDGE",
      "elk.layered.wrapping.targetWidth": String(targetWrapWidth),

      "elk.layered.mergeEdges": "false",
    },
  };

  const out = await elk.layout(graph);

  const layout: Record<string, Layout> = {};
  for (const n of out.children ?? []) {
    layout[n.id] = {
      x: n.x ?? 0,
      y: n.y ?? 0,
      width: n.width ?? TABLE_WIDTH,
      height: n.height ?? 0,
    };
  }

  const routed: RoutedEdge[] = (out.edges ?? [])
    .map((e: any) => {
      const idx = Number(String(e.id).split(":")[1]);
      const relation = relations[idx];
      if (!relation) return null;

      let pts = pointsFromElkEdge(e);
      if (!pts) return null;

      // ELK gives route parent -> child; your semantic relation is child -> parent.
      // Reverse so markerEnd points at referenced table (toTable).
      pts = pts.slice().reverse();
      pts = simplifyOrthogonal(pts);

      const sm = portMeta.get(`port:child:${idx}`); // start table after reverse
      const em = portMeta.get(`port:parent:${idx}`); // end table after reverse

      // Fan-out only when multiple edges share that table side
      if (sm && sm.laneCount > 1)
        pts = addEndpointFan(pts, sm.side, sm.laneIndex, sm.laneCount, "start");
      if (em && em.laneCount > 1)
        pts = addEndpointFan(pts, em.side, em.laneIndex, em.laneCount, "end");

      // Ensure decent lead lengths even for single edges (or center lanes)
      const MIN_LEAD = 24;
      if (sm) pts = ensureMinLead(pts, sm.side, "start", MIN_LEAD);
      if (em) pts = ensureMinLead(pts, em.side, "end", MIN_LEAD);

      pts = simplifyOrthogonal(pts);

      return { id: e.id, relation, points: pts } satisfies RoutedEdge;
    })
    .filter(Boolean);

  // --- normalize to positive canvas coords with padding ---
  let minX = Infinity;
  let minY = Infinity;

  for (const b of Object.values(layout)) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
  }
  for (const ed of routed) {
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
  for (const ed of routed) {
    ed.points = ed.points.map((p) => ({ x: p.x + shiftX, y: p.y + shiftY }));
  }

  let maxX = 0;
  let maxY = 0;

  for (const b of Object.values(layout)) {
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  for (const ed of routed) {
    for (const p of ed.points) {
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  return {
    layout,
    edges: routed,
    size: {
      width: Math.ceil(maxX + LAYOUT_PADDING),
      height: Math.ceil(maxY + LAYOUT_PADDING),
    },
  };
}
