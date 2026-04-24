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

function getColumnCenterY(table: Table, columnName: string) {
  const idx = table.columns.findIndex((c) => c.name === columnName);
  const safe = idx >= 0 ? idx : 0;
  return TABLE_HEADER_HEIGHT + safe * TABLE_ROW_HEIGHT + TABLE_ROW_HEIGHT / 2;
}

function getColumnCenterX(table: Table, columnName: string) {
  const idx = table.columns.findIndex((c) => c.name === columnName);
  const safe = idx >= 0 ? idx : 0;
  const denom = Math.max(2, table.columns.length + 1);
  return (TABLE_WIDTH * (safe + 1)) / denom;
}

function sideToward(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): Side {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;

  const dx = bx - ax;
  const dy = by - ay;

  if (Math.abs(dx) >= Math.abs(dy) * 1.15) return dx >= 0 ? "EAST" : "WEST";
  return dy >= 0 ? "SOUTH" : "NORTH";
}

function oppositeSide(s: Side): Side {
  if (s === "EAST") return "WEST";
  if (s === "WEST") return "EAST";
  if (s === "NORTH") return "SOUTH";
  return "NORTH";
}

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

  const BASE = 14;
  const STEP = 10;
  const dist = BASE + lane * STEP;

  const norm =
    side === "EAST"
      ? { x: 1, y: 0 }
      : side === "WEST"
        ? { x: -1, y: 0 }
        : side === "SOUTH"
          ? { x: 0, y: 1 }
          : { x: 0, y: -1 };

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

function distributeOnSpan(
  base: number[],
  min: number,
  max: number,
  minGap: number,
) {
  const span = Math.max(0, max - min);
  const n = base.length;
  if (n === 0) return [];

  if (n * minGap > span && span > 0) {
    const step = span / (n + 1);
    return Array.from({ length: n }, (_, i) => min + (i + 1) * step);
  }

  const placed: number[] = [];
  for (let i = 0; i < n; i++) {
    const lane = i - (n - 1) / 2;
    const desired = base[i] + lane * minGap;
    placed.push(clamp(desired, min, max));
  }

  for (let i = 1; i < placed.length; i++) {
    if (placed[i] - placed[i - 1] < minGap) placed[i] = placed[i - 1] + minGap;
  }
  for (let i = placed.length - 2; i >= 0; i--) {
    if (placed[i + 1] - placed[i] < minGap) placed[i] = placed[i + 1] - minGap;
  }
  for (let i = 0; i < placed.length; i++)
    placed[i] = clamp(placed[i], min, max);

  return placed;
}

export async function buildOptimalLayoutElk(
  tables: Table[],
  relations: Relation[],
  options?: { availableWidth?: number },
): Promise<BuildElkResult> {
  const elk = new ELK();

  const tableByName = new Map(tables.map((t) => [t.name, t]));

  const inCount = new Map<string, number>();
  const outCount = new Map<string, number>();
  for (const t of tables) {
    inCount.set(t.name, 0);
    outCount.set(t.name, 0);
  }
  for (const r of relations) {
    outCount.set(r.fromTable, (outCount.get(r.fromTable) ?? 0) + 1);
    inCount.set(r.toTable, (inCount.get(r.toTable) ?? 0) + 1);
  }
  const degree = (name: string) =>
    (inCount.get(name) ?? 0) + (outCount.get(name) ?? 0);
  const maxDeg = Math.max(0, ...tables.map((t) => degree(t.name)));
  const HUB_THRESHOLD = Math.max(8, Math.floor(maxDeg * 0.75));

  const availableWidth = Math.max(520, options?.availableWidth ?? 1200);
  const targetWrapWidth = Math.max(
    520,
    Math.floor((availableWidth - LAYOUT_PADDING * 2) * 0.78),
  );

  const preNodes = tables.map((t) => ({
    id: t.name,
    width: TABLE_WIDTH,
    height: getTableHeight(t),
  }));

  const preEdges = relations
    .map((r, i) => {
      if (!tableByName.has(r.fromTable) || !tableByName.has(r.toTable))
        return null;
      return { id: `pre:${i}`, sources: [r.fromTable], targets: [r.toTable] };
    })
    .filter(Boolean);

  const preGraph: any = {
    id: "preRoot",
    children: preNodes,
    edges: preEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "LEFT",
      "elk.edgeRouting": "POLYLINE",

      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,

      "elk.spacing.nodeNode": "32",
      "elk.layered.spacing.nodeNodeBetweenLayers": "84",
      "elk.layered.wrapping.strategy": "MULTI_EDGE",
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

  type Endpoint = {
    relIndex: number;
    tableName: string;
    columnName: string;
    side: Side;
    baseAlong: number;
    portId: string;
    kind: "from" | "to";
  };

  const endpoints: Endpoint[] = [];

  relations.forEach((r, i) => {
    const fromT = tableByName.get(r.fromTable);
    const toT = tableByName.get(r.toTable);
    const fromB = preBox.get(r.fromTable);
    const toB = preBox.get(r.toTable);
    if (!fromT || !toT || !fromB || !toB) return;

    const fromSide = sideToward(fromB, toB);
    const toSide = sideToward(toB, fromB);

    const baseFrom =
      fromSide === "EAST" || fromSide === "WEST"
        ? getColumnCenterY(fromT, r.fromColumn)
        : getColumnCenterX(fromT, r.fromColumn);

    const baseTo =
      toSide === "EAST" || toSide === "WEST"
        ? getColumnCenterY(toT, r.toColumn)
        : getColumnCenterX(toT, r.toColumn);

    endpoints.push({
      relIndex: i,
      tableName: r.fromTable,
      columnName: r.fromColumn,
      side: fromSide,
      baseAlong: baseFrom,
      portId: `port:from:${i}`,
      kind: "from",
    });

    endpoints.push({
      relIndex: i,
      tableName: r.toTable,
      columnName: r.toColumn,
      side: toSide,
      baseAlong: baseTo,
      portId: `port:to:${i}`,
      kind: "to",
    });
  });

  const endpointsByTableSide = new Map<string, Endpoint[]>();
  for (const ep of endpoints) {
    const k = `${ep.tableName}|${ep.side}`;
    if (!endpointsByTableSide.has(k)) endpointsByTableSide.set(k, []);
    endpointsByTableSide.get(k)!.push(ep);
  }

  const portPositions = new Map<string, { x: number; y: number; side: Side }>();
  const portMeta = new Map<
    string,
    { laneIndex: number; laneCount: number; side: Side }
  >();

  for (const [key, group] of endpointsByTableSide.entries()) {
    group.sort((a, b) => a.baseAlong - b.baseAlong || a.relIndex - b.relIndex);

    const [tableName, side] = key.split("|") as [string, Side];
    const t = tableByName.get(tableName);
    if (!t) continue;

    const h = getTableHeight(t);

    if (side === "EAST" || side === "WEST") {
      const minY = TABLE_HEADER_HEIGHT + 10;
      const maxY = h - 10;
      const bases = group.map((g) => g.baseAlong);
      const ys = distributeOnSpan(bases, minY, maxY, 12);

      for (let i = 0; i < group.length; i++) {
        const ep = group[i];
        const x = side === "EAST" ? TABLE_WIDTH : 0;
        const y = ys[i];
        portPositions.set(ep.portId, { x, y, side });
        portMeta.set(ep.portId, {
          laneIndex: i,
          laneCount: group.length,
          side,
        });
      }
    } else {
      const minX = 12;
      const maxX = TABLE_WIDTH - 12;
      const bases = group.map((g) => g.baseAlong);
      const xs = distributeOnSpan(bases, minX, maxX, 14);

      for (let i = 0; i < group.length; i++) {
        const ep = group[i];
        const x = xs[i];
        const y = side === "SOUTH" ? h : 0;
        portPositions.set(ep.portId, { x, y, side });
        portMeta.set(ep.portId, {
          laneIndex: i,
          laneCount: group.length,
          side,
        });
      }
    }
  }

  const elkNodes = tables.map((t) => {
    const ports = endpoints
      .filter((ep) => ep.tableName === t.name)
      .map((ep) => {
        const pos = portPositions.get(ep.portId)!;
        return {
          id: ep.portId,
          width: 1,
          height: 1,
          x: pos.x,
          y: pos.y,
          layoutOptions: { "elk.port.side": pos.side },
        };
      });

    const d = degree(t.name);
    const margin =
      d >= HUB_THRESHOLD ? 46 : d >= Math.max(5, HUB_THRESHOLD - 2) ? 34 : 22;

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

  const elkEdges = relations
    .map((r, i) => {
      if (!tableByName.has(r.fromTable) || !tableByName.has(r.toTable))
        return null;
      return {
        id: `edge:${i}`,
        sources: [`port:from:${i}`],
        targets: [`port:to:${i}`],
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
      "elk.direction": "LEFT",
      "elk.edgeRouting": "ORTHOGONAL",

      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,

      "elk.spacing.nodeNode": "34",
      "elk.layered.spacing.nodeNodeBetweenLayers": "92",

      "elk.spacing.edgeEdge": "24",
      "elk.spacing.edgeNode": "26",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "24",

      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
      "elk.layered.cycleBreaking.strategy": "GREEDY",

      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.layered.nodePlacement.favorStraightEdges": "true",

      "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",

      "elk.layered.wrapping.strategy": "MULTI_EDGE",
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

      const sec = e.sections?.[0];
      if (!sec?.startPoint || !sec?.endPoint) return null;

      let pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map(
        (p: any) => ({ x: p.x, y: p.y }),
      );

      pts = simplifyOrthogonal(pts);

      const sm = portMeta.get(`port:from:${idx}`);
      const em = portMeta.get(`port:to:${idx}`);

      if (sm)
        pts = addEndpointFan(pts, sm.side, sm.laneIndex, sm.laneCount, "start");
      if (em)
        pts = addEndpointFan(pts, em.side, em.laneIndex, em.laneCount, "end");

      return { id: e.id, relation, points: pts } satisfies RoutedEdge;
    })
    .filter(Boolean);

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
