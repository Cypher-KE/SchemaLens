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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function getColumnCenterY(table: Table, columnName: string) {
  const idx = table.columns.findIndex((c) => c.name === columnName);
  const safe = idx >= 0 ? idx : 0;
  return TABLE_HEADER_HEIGHT + safe * TABLE_ROW_HEIGHT + TABLE_ROW_HEIGHT / 2;
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

function addEndpointFan(
  points: Point[],
  side: "EAST" | "WEST",
  laneIndex: number,
  laneCount: number,
  which: "start" | "end",
) {
  if (points.length < 2) return points;
  if (laneCount <= 1) return points;

  const outward = side === "EAST" ? 1 : -1;
  const lane = laneIndex - (laneCount - 1) / 2;

  const BASE = 18;
  const STEP = 10;
  const fanDist = BASE + lane * STEP;

  if (which === "end") {
    const prev = points[points.length - 2];
    const end = points[points.length - 1];
    const fanX = end.x + outward * fanDist;

    return simplifyOrthogonal([
      ...points.slice(0, -1),
      { x: fanX, y: prev.y },
      { x: fanX, y: end.y },
      end,
    ]);
  } else {
    const start = points[0];
    const next = points[1];
    const fanX = start.x + outward * fanDist;

    return simplifyOrthogonal([
      start,
      { x: fanX, y: start.y },
      { x: fanX, y: next.y },
      ...points.slice(1),
    ]);
  }
}

export async function buildOptimalLayoutElk(
  tables: Table[],
  relations: Relation[],
  options?: { availableWidth?: number },
): Promise<BuildElkResult> {
  const elk = new ELK();
  const tableByName = new Map(tables.map((t) => [t.name, t]));

  const availableWidth = Math.max(520, options?.availableWidth ?? 1200);
  const targetWrapWidth = Math.max(520, availableWidth - LAYOUT_PADDING * 2);

  type Endpoint = {
    relIndex: number;
    tableName: string;
    columnName: string;
    side: "EAST" | "WEST";
    baseY: number;
    portId: string;
  };

  const endpointsByKey = new Map<string, Endpoint[]>();
  const endpoints: Endpoint[] = [];

  relations.forEach((r, i) => {
    const child = tableByName.get(r.fromTable);
    const parent = tableByName.get(r.toTable);
    if (!child || !parent) return;

    const parentBaseY = getColumnCenterY(parent, r.toColumn);
    const childBaseY = getColumnCenterY(child, r.fromColumn);

    const parentEp: Endpoint = {
      relIndex: i,
      tableName: r.toTable,
      columnName: r.toColumn,
      side: "EAST",
      baseY: parentBaseY,
      portId: `port:parent:${i}`,
    };

    const childEp: Endpoint = {
      relIndex: i,
      tableName: r.fromTable,
      columnName: r.fromColumn,
      side: "WEST",
      baseY: childBaseY,
      portId: `port:child:${i}`,
    };

    const k1 = `${parentEp.tableName}|${parentEp.columnName}|${parentEp.side}`;
    const k2 = `${childEp.tableName}|${childEp.columnName}|${childEp.side}`;

    if (!endpointsByKey.has(k1)) endpointsByKey.set(k1, []);
    if (!endpointsByKey.has(k2)) endpointsByKey.set(k2, []);

    endpointsByKey.get(k1)!.push(parentEp);
    endpointsByKey.get(k2)!.push(childEp);

    endpoints.push(parentEp, childEp);
  });

  const portPositions = new Map<
    string,
    { x: number; y: number; side: "EAST" | "WEST" }
  >();

  const portMeta = new Map<
    string,
    { laneIndex: number; laneCount: number; side: "EAST" | "WEST" }
  >();

  for (const group of endpointsByKey.values()) {
    group.sort((a, b) => a.relIndex - b.relIndex);

    const laneCount = group.length;
    const step = 11;

    for (let j = 0; j < group.length; j++) {
      const ep = group[j];
      const t = tableByName.get(ep.tableName);
      if (!t) continue;

      const lane = j - (laneCount - 1) / 2;
      const y = ep.baseY + lane * step;

      const minY = TABLE_HEADER_HEIGHT + 10;
      const maxY = getTableHeight(t) - 10;
      const yClamped = clamp(y, minY, maxY);

      const x = ep.side === "EAST" ? TABLE_WIDTH : 0;

      portPositions.set(ep.portId, { x, y: yClamped, side: ep.side });
      portMeta.set(ep.portId, { laneIndex: j, laneCount, side: ep.side });
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

    return {
      id: t.name,
      width: TABLE_WIDTH,
      height: getTableHeight(t),
      ports,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    };
  });

  const elkEdges = relations
    .map((r, i) => {
      const child = tableByName.get(r.fromTable);
      const parent = tableByName.get(r.toTable);
      if (!child || !parent) return null;

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

      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,

      "elk.spacing.nodeNode": "30",
      "elk.layered.spacing.nodeNodeBetweenLayers": "74",

      "elk.spacing.edgeEdge": "22",
      "elk.spacing.edgeNode": "24",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "22",

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

      pts.reverse();

      const startPortId = `port:child:${idx}`;
      const endPortId = `port:parent:${idx}`;

      const sm = portMeta.get(startPortId);
      const em = portMeta.get(endPortId);

      pts = simplifyOrthogonal(pts);

      if (sm) {
        pts = addEndpointFan(pts, sm.side, sm.laneIndex, sm.laneCount, "start");
      }
      if (em) {
        pts = addEndpointFan(pts, em.side, em.laneIndex, em.laneCount, "end");
      }

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
