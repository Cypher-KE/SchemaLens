import ELK from "elkjs/lib/elk.bundled.js";
import type {
  DiagramFormat,
  Layout,
  Relation,
  RoutedEdge,
  Table,
  Point,
} from "../types";
import {
  getTableHeight,
  TABLE_WIDTH,
  LAYOUT_PADDING,
  TABLE_HEADER_HEIGHT,
  TABLE_ROW_HEIGHT,
} from "./schemaParser";

type BuildElkResult = {
  layout: Record<string, Layout>;
  edges: RoutedEdge[];
  size: { width: number; height: number };
};

type Side = "EAST" | "WEST" | "NORTH" | "SOUTH";
const SIDES: Side[] = ["EAST", "WEST", "NORTH", "SOUTH"];
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

function extendLeadWithoutExtraBends(
  points: Point[],
  side: Side,
  which: "start" | "end",
  minLead: number,
) {
  if (points.length < 2) return points;

  const n = sideNormal(side);
  const out = points.map((p) => ({ ...p }));

  if (which === "start") {
    const a = out[0];
    const b = out[1];

    if (n.x !== 0) {
      if (a.y !== b.y) return points;
      if (Math.sign(b.x - a.x) !== Math.sign(n.x)) return points;

      const len = Math.abs(b.x - a.x);
      if (len >= minLead) return points;

      const oldX = b.x;
      const newX = a.x + n.x * minLead;

      out[1].x = newX;
      for (let i = 2; i < out.length; i++) {
        if (out[i].x !== oldX) break;
        out[i].x = newX;
      }

      return simplifyOrthogonal(out);
    }

    if (n.y !== 0) {
      if (a.x !== b.x) return points;
      if (Math.sign(b.y - a.y) !== Math.sign(n.y)) return points;

      const len = Math.abs(b.y - a.y);
      if (len >= minLead) return points;

      const oldY = b.y;
      const newY = a.y + n.y * minLead;

      out[1].y = newY;
      for (let i = 2; i < out.length; i++) {
        if (out[i].y !== oldY) break;
        out[i].y = newY;
      }

      return simplifyOrthogonal(out);
    }

    return points;
  } else {
    const a = out[out.length - 2];
    const b = out[out.length - 1];

    if (n.x !== 0) {
      if (a.y !== b.y) return points;
      if (Math.sign(b.x - a.x) !== -Math.sign(n.x)) return points;

      const len = Math.abs(b.x - a.x);
      if (len >= minLead) return points;

      const oldX = a.x;
      const newX = b.x + n.x * minLead;

      out[out.length - 2].x = newX;
      for (let i = out.length - 3; i >= 0; i--) {
        if (out[i].x !== oldX) break;
        out[i].x = newX;
      }

      return simplifyOrthogonal(out);
    }

    if (n.y !== 0) {
      if (a.x !== b.x) return points;
      if (Math.sign(b.y - a.y) !== -Math.sign(n.y)) return points;

      const len = Math.abs(b.y - a.y);
      if (len >= minLead) return points;

      const oldY = a.y;
      const newY = b.y + n.y * minLead;

      out[out.length - 2].y = newY;
      for (let i = out.length - 3; i >= 0; i--) {
        if (out[i].y !== oldY) break;
        out[i].y = newY;
      }

      return simplifyOrthogonal(out);
    }

    return points;
  }
}

function laneOrderFromOffset(laneOffset: number) {
  if (laneOffset === 0) return 0;
  const a = Math.abs(laneOffset);
  return a * 2 + (laneOffset > 0 ? 1 : 0);
}

function getColumnCenterY(table: Table, columnName: string) {
  const idx = table.columns.findIndex((c) => c.name === columnName);
  const safe = idx >= 0 ? idx : 0;
  return TABLE_HEADER_HEIGHT + safe * TABLE_ROW_HEIGHT + TABLE_ROW_HEIGHT / 2;
}

function portCenterForSide(
  table: Table,
  side: Side,
  columnName: string,
  mode: DiagramFormat,
): Point {
  const h = getTableHeight(table);

  if (mode === "erd") {
    if (side === "EAST") return { x: TABLE_WIDTH, y: h / 2 };
    if (side === "WEST") return { x: 0, y: h / 2 };
    if (side === "SOUTH") return { x: TABLE_WIDTH / 2, y: h };
    return { x: TABLE_WIDTH / 2, y: 0 };
  }

  if (side === "EAST")
    return { x: TABLE_WIDTH, y: getColumnCenterY(table, columnName) };
  if (side === "WEST") return { x: 0, y: getColumnCenterY(table, columnName) };
  if (side === "SOUTH") return { x: TABLE_WIDTH / 2, y: h };
  return { x: TABLE_WIDTH / 2, y: 0 };
}

function nudgeToMinGap(
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

function chooseChildSideByCost(args: {
  mode: DiagramFormat;
  child: Table;
  parent: Table;
  childBox: { x: number; y: number; w: number; h: number };
  parentBox: { x: number; y: number; w: number; h: number };
  childColumn: string;
  parentColumn: string;
}): Side {
  const {
    mode,
    child,
    parent,
    childBox,
    parentBox,
    childColumn,
    parentColumn,
  } = args;

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

  const absX = Math.abs(vec.x);
  const absY = Math.abs(vec.y);
  const preferVertical = absY > absX * 1.12;

  let bestSide: Side = "WEST";
  let bestScore = Number.POSITIVE_INFINITY;

  for (const side of SIDES) {
    const parentSide = oppositeSide(side);

    const childPort = portCenterForSide(child, side, childColumn, mode);
    const parentPort = portCenterForSide(
      parent,
      parentSide,
      parentColumn,
      mode,
    );

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
    const dot = (vec.x * n.x + vec.y * n.y) / len;
    const facingPenalty = dot < 0 ? 3200 : (1 - dot) * 260;

    const axisPenalty = preferVertical
      ? side === "EAST" || side === "WEST"
        ? 520
        : 0
      : side === "NORTH" || side === "SOUTH"
        ? 420
        : 0;

    const score = manhattan + facingPenalty + axisPenalty;

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

function baseAlongFromGeometry(args: {
  selfSide: Side;
  selfBox: { x: number; y: number; w: number; h: number };
  otherCenter: { x: number; y: number };
}) {
  const { selfSide, selfBox, otherCenter } = args;

  if (selfSide === "EAST" || selfSide === "WEST") {
    return otherCenter.y - selfBox.y;
  }
  return otherCenter.x - selfBox.x;
}

function baseAlongForSql(table: Table, side: Side, columnName: string) {
  if (side === "EAST" || side === "WEST")
    return getColumnCenterY(table, columnName);
  return TABLE_WIDTH / 2;
}

export async function buildOptimalLayoutElk(
  tables: Table[],
  relations: Relation[],
  options?: { availableWidth?: number; mode?: DiagramFormat },
): Promise<BuildElkResult> {
  const mode: DiagramFormat = options?.mode ?? "sql";
  const elk = new ELK();
  const tableByName = new Map(tables.map((t) => [t.name, t]));

  const portMeta = new Map<
    string,
    { laneOffset: number; laneCount: number; side: Side }
  >();

  const availableWidth = Math.max(520, options?.availableWidth ?? 1200);
  const targetWrapWidth = Math.max(
    520,
    Math.floor((availableWidth - LAYOUT_PADDING * 2) * 0.99),
  );

  const direction = mode === "erd" ? "DOWN" : "RIGHT";
  const nodeNode = mode === "erd" ? "44" : "28";
  const betweenLayers = mode === "erd" ? "128" : "86";
  const edgeEdge = mode === "erd" ? "22" : "14";
  const edgeNode = mode === "erd" ? "30" : "22";
  const minSeg = mode === "erd" ? "44" : "28";

  const preNodes = tables.map((t) => ({
    id: t.name,
    width: TABLE_WIDTH,
    height: getTableHeight(t),
  }));

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
      "elk.direction": direction,
      "elk.edgeRouting": "POLYLINE",
      "elk.layered.unnecessaryBendpoints": "true",
      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,
      "elk.spacing.nodeNode": nodeNode,
      "elk.layered.spacing.nodeNodeBetweenLayers": betweenLayers,
      "elk.layered.wrapping.strategy":
        mode === "erd" ? "MULTI_EDGE" : "SINGLE_EDGE",
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

    const childCenter = {
      x: childB.x + childB.w / 2,
      y: childB.y + childB.h / 2,
    };
    const parentCenter = {
      x: parentB.x + parentB.w / 2,
      y: parentB.y + parentB.h / 2,
    };

    const childSide = chooseChildSideByCost({
      mode,
      child,
      parent,
      childBox: childB,
      parentBox: parentB,
      childColumn: r.fromColumn,
      parentColumn: r.toColumn,
    });

    const parentSide = oppositeSide(childSide);

    const childBase =
      mode === "erd"
        ? baseAlongFromGeometry({
            selfSide: childSide,
            selfBox: childB,
            otherCenter: parentCenter,
          })
        : baseAlongForSql(child, childSide, r.fromColumn);

    const parentBase =
      mode === "erd"
        ? baseAlongFromGeometry({
            selfSide: parentSide,
            selfBox: parentB,
            otherCenter: childCenter,
          })
        : baseAlongForSql(parent, parentSide, r.toColumn);

    endpoints.push({
      relIndex: i,
      tableName: r.fromTable,
      columnName: r.fromColumn,
      side: childSide,
      baseAlong: childBase,
      portId: `port:child:${i}`,
      kind: "child",
    });

    endpoints.push({
      relIndex: i,
      tableName: r.toTable,
      columnName: r.toColumn,
      side: parentSide,
      baseAlong: parentBase,
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

  const portCenters = new Map<string, { x: number; y: number; side: Side }>();

  for (const [key, group] of endpointsByTableSide.entries()) {
    group.sort((a, b) => a.baseAlong - b.baseAlong || a.relIndex - b.relIndex);

    const [tableName, side] = key.split("|") as [string, Side];
    const t = tableByName.get(tableName);
    if (!t) continue;

    const h = getTableHeight(t);
    const spineIndex = Math.floor((group.length - 1) / 2);

    if (side === "EAST" || side === "WEST") {
      const minY = TABLE_HEADER_HEIGHT + TABLE_ROW_HEIGHT / 2;
      const maxY = h - TABLE_ROW_HEIGHT / 2;

      const bases = group.map((g) => g.baseAlong);
      const span = Math.max(0, maxY - minY);

      const minGap = clamp(
        Math.round(span / (group.length + 1)),
        mode === "erd" ? 14 : 8,
        mode === "erd" ? 28 : 14,
      );

      const baseMin = Math.min(...bases);
      const baseMax = Math.max(...bases);
      const baseRange = baseMax - baseMin;

      const seeded =
        group.length > 1 && baseRange < minGap * 0.2
          ? bases.map((b, i) => b + (i - (group.length - 1) / 2) * minGap)
          : bases;

      const ys = nudgeToMinGap(seeded, minY, maxY, minGap);
      const cx = side === "EAST" ? TABLE_WIDTH : 0;

      for (let i = 0; i < group.length; i++) {
        const ep = group[i];
        portCenters.set(ep.portId, { x: cx, y: ys[i], side });
        portMeta.set(ep.portId, {
          laneOffset: i - spineIndex,
          laneCount: group.length,
          side,
        });
      }
    } else {
      const minX = 18;
      const maxX = TABLE_WIDTH - 18;

      const bases = group.map((g) => g.baseAlong);
      const span = Math.max(0, maxX - minX);

      const minGap = clamp(
        Math.round(span / (group.length + 1)),
        mode === "erd" ? 16 : 10,
        mode === "erd" ? 36 : 18,
      );

      const baseMin = Math.min(...bases);
      const baseMax = Math.max(...bases);
      const baseRange = baseMax - baseMin;

      const seeded =
        group.length > 1 && baseRange < minGap * 0.2
          ? bases.map((b, i) => b + (i - (group.length - 1) / 2) * minGap)
          : bases;

      const xs = nudgeToMinGap(seeded, minX, maxX, minGap);
      const cy = side === "SOUTH" ? h : 0;

      for (let i = 0; i < group.length; i++) {
        const ep = group[i];
        portCenters.set(ep.portId, { x: xs[i], y: cy, side });
        portMeta.set(ep.portId, {
          laneOffset: i - spineIndex,
          laneCount: group.length,
          side,
        });
      }
    }
  }

  const degree = new Map<string, number>();
  for (const t of tables) degree.set(t.name, 0);
  for (const r of relations) {
    degree.set(r.fromTable, (degree.get(r.fromTable) ?? 0) + 1);
    degree.set(r.toTable, (degree.get(r.toTable) ?? 0) + 1);
  }

  const elkNodes = tables.map((t) => {
    const d = degree.get(t.name) ?? 0;

    const margin =
      mode === "erd"
        ? d >= 10
          ? 62
          : d >= 6
            ? 52
            : 40
        : d >= 10
          ? 34
          : d >= 6
            ? 26
            : 18;

    const ports = endpoints
      .filter((ep) => ep.tableName === t.name)
      .map((ep) => {
        const c = portCenters.get(ep.portId);
        if (!c) return null;

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
      "elk.direction": direction,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.unnecessaryBendpoints": "true",
      "elk.orthogonalRouting.minimumSegmentLength": minSeg,
      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,
      "elk.spacing.nodeNode": nodeNode,
      "elk.layered.spacing.nodeNodeBetweenLayers": betweenLayers,
      "elk.spacing.edgeEdge": edgeEdge,
      "elk.spacing.edgeNode": edgeNode,
      "elk.layered.spacing.edgeEdgeBetweenLayers": mode === "erd" ? "20" : "16",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
      "elk.layered.cycleBreaking.strategy": "GREEDY",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.layered.nodePlacement.favorStraightEdges": "true",
      "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
      "elk.layered.wrapping.strategy":
        mode === "erd" ? "MULTI_EDGE" : "SINGLE_EDGE",
      "elk.layered.wrapping.targetWidth": String(targetWrapWidth),
      "elk.layered.mergeEdges": "false",
    },
  };

  const out = await elk.layout(graph);

  const layout: Record<string, Layout> = {};
  for (const n of out.children ?? []) {
    layout[n.id] = {
      x: Math.round(n.x ?? 0),
      y: Math.round(n.y ?? 0),
      width: Math.round(n.width ?? TABLE_WIDTH),
      height: Math.round(n.height ?? 0),
    };
  }

  const routed: RoutedEdge[] = (out.edges ?? [])
    .map((e: any) => {
      const idx = Number(String(e.id).split(":")[1]);
      const relation = relations[idx];
      if (!relation) return null;

      let pts = pointsFromElkEdge(e);
      if (!pts) return null;

      pts = pts.slice().reverse();
      pts = simplifyOrthogonal(pts);

      const sm = portMeta.get(`port:child:${idx}`);
      const em = portMeta.get(`port:parent:${idx}`);

      const BASE_LEAD = mode === "erd" ? 34 : 26;
      const STEP_LEAD = mode === "erd" ? 14 : 10;
      const MAX_LEAD = mode === "erd" ? 120 : 86;

      if (sm) {
        const order = laneOrderFromOffset(sm.laneOffset);
        const desiredLead = clamp(
          BASE_LEAD + order * STEP_LEAD,
          BASE_LEAD,
          MAX_LEAD,
        );
        pts = extendLeadWithoutExtraBends(pts, sm.side, "start", desiredLead);
      }

      if (em) {
        const order = laneOrderFromOffset(em.laneOffset);
        const desiredLead = clamp(
          BASE_LEAD + order * STEP_LEAD,
          BASE_LEAD,
          MAX_LEAD,
        );
        pts = extendLeadWithoutExtraBends(pts, em.side, "end", desiredLead);
      }

      pts = simplifyOrthogonal(pts);

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
