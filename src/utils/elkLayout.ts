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

// Small but visible; ports are only for routing anchors
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

function getColumnCenterY(table: Table, columnName: string) {
  const idx = table.columns.findIndex((c) => c.name === columnName);
  const safe = idx >= 0 ? idx : 0;
  return TABLE_HEADER_HEIGHT + safe * TABLE_ROW_HEIGHT + TABLE_ROW_HEIGHT / 2;
}

/**
 * We want ports to represent "this column row" visually.
 * That only makes sense on EAST/WEST sides (y coordinate).
 * For NORTH/SOUTH, use a centered x (looks clean and avoids fake "column x").
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
 *
 * This preserves "attach to this column row" much better than your previous
 * distributeOnSpan(), which drifted ports even when they didn't need to.
 */
function nudgeToMinGap(
  bases: number[],
  min: number,
  max: number,
  minGap: number,
) {
  const n = bases.length;
  if (n === 0) return [];

  // initial
  const placed = bases.map((b) => clamp(b, min, max));

  // forward enforce
  for (let i = 1; i < n; i++) {
    if (placed[i] - placed[i - 1] < minGap) {
      placed[i] = placed[i - 1] + minGap;
    }
  }

  // shift down if overflow
  const overflow = placed[n - 1] - max;
  if (overflow > 0) {
    for (let i = 0; i < n; i++) placed[i] -= overflow;
  }

  // backward enforce
  for (let i = n - 2; i >= 0; i--) {
    if (placed[i + 1] - placed[i] < minGap) {
      placed[i] = placed[i + 1] - minGap;
    }
  }

  // shift up if underflow
  const underflow = min - placed[0];
  if (underflow > 0) {
    for (let i = 0; i < n; i++) placed[i] += underflow;
  }

  return placed.map((p) => clamp(p, min, max));
}

/**
 * Choose a side on CHILD (fromTable) that yields a short orthogonal path to PARENT (toTable),
 * while strongly preferring a side that actually faces the parent.
 *
 * Also adds a small penalty for NORTH/SOUTH since those don't correspond to a real "column row".
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

    // Facing penalty (prefer sides that point toward the parent)
    const n = sideNormal(side);
    const dot = (vec.x * n.x + vec.y * n.y) / len; // [-1..1]
    const facingPenalty = dot < 0 ? 2500 : (1 - dot) * 220; // huge penalty if pointing away

    // NORTH/SOUTH penalty: only use if it materially helps
    const nsPenalty = side === "NORTH" || side === "SOUTH" ? 160 : 0;

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

  // Use a more “fit width” target and don’t wrap too early (your 0.78 caused early wrapping)
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

  // IMPORTANT: for layout quality we treat edges as PARENT -> CHILD (referenced -> referencing)
  const preEdges = relations
    .map((r, i) => {
      if (!tableByName.has(r.fromTable) || !tableByName.has(r.toTable))
        return null;
      // parent = toTable, child = fromTable
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
      // Keep ports on/near actual column row centers
      const minY = TABLE_HEADER_HEIGHT + TABLE_ROW_HEIGHT / 2;
      const maxY = h - TABLE_ROW_HEIGHT / 2;

      const bases = group.map((g) => g.baseAlong);
      const ys = nudgeToMinGap(bases, minY, maxY, 8);

      const cx = side === "EAST" ? TABLE_WIDTH : 0;

      for (let i = 0; i < group.length; i++) {
        portCenters.set(group[i].portId, { x: cx, y: ys[i], side });
      }
    } else {
      // NORTH/SOUTH: centered-ish x looks better than pretending there's a "column x"
      const minX = 18;
      const maxX = TABLE_WIDTH - 18;

      const bases = group.map((g) => g.baseAlong);
      const xs = nudgeToMinGap(bases, minX, maxX, 12);

      const cy = side === "SOUTH" ? h : 0;

      for (let i = 0; i < group.length; i++) {
        portCenters.set(group[i].portId, { x: xs[i], y: cy, side });
      }
    }
  }

  // Degree-based margin (smaller than before; large margins can cause huge detours)
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

        // ELK uses (x,y) as top-left of the port
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

  // ELK edges are PARENT -> CHILD for better layered placement + routing
  const elkEdges = relations
    .map((r, i) => {
      if (!tableByName.has(r.fromTable) || !tableByName.has(r.toTable))
        return null;
      return {
        id: `edge:${i}`,
        sources: [`port:parent:${i}`], // toTable
        targets: [`port:child:${i}`], // fromTable
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

      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,

      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "86",

      "elk.spacing.edgeEdge": "14",
      "elk.spacing.edgeNode": "18",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "16",

      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
      "elk.layered.cycleBreaking.strategy": "GREEDY",

      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.layered.nodePlacement.favorStraightEdges": "true",

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

      // ELK route is parent -> child; your semantic relation is child -> parent.
      // Reverse so markerEnd points at the referenced table (toTable).
      pts = simplifyOrthogonal(pts).slice().reverse();
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
