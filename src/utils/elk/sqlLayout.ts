import type ELK from "elkjs/lib/elk.bundled.js";
import type {
  Layout,
  LayoutDirection,
  Relation,
  RoutedEdge,
  Table,
  Point,
} from "../../types";
import {
  getTableHeight,
  LAYOUT_PADDING,
  TABLE_HEADER_HEIGHT,
  TABLE_ROW_HEIGHT,
  TABLE_WIDTH,
} from "../schemaParser";
import {
  clamp,
  extendLeadWithoutExtraBends,
  ensureMinEndpointLegs,
  nudgeToMinGap,
  normalizeWithPadding,
  oppositeSide,
  pointsFromElkEdge,
  simplifyOrthogonal,
  type Side,
} from "./common";

const PORT_SIZE = 2;

type Rect = { x: number; y: number; width: number; height: number };

function inflateRect(r: Rect, pad: number): Rect {
  return {
    x: r.x - pad,
    y: r.y - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
}

function segmentIntersectsRect(a: Point, b: Point, r: Rect) {
  if (a.x === b.x) {
    const x = a.x;
    if (x < r.x || x > r.x + r.width) return false;
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    return !(y1 < r.y || y0 > r.y + r.height);
  }
  if (a.y === b.y) {
    const y = a.y;
    if (y < r.y || y > r.y + r.height) return false;
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    return !(x1 < r.x || x0 > r.x + r.width);
  }
  return false;
}

function pathLength(points: Point[]) {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += Math.hypot(
      points[i + 1].x - points[i].x,
      points[i + 1].y - points[i].y,
    );
  }
  return len;
}

function intersectionHits(points: Point[], obstacles: Rect[]) {
  let hits = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (const r of obstacles) if (segmentIntersectsRect(a, b, r)) hits++;
  }
  return hits;
}

function backtracksX(points: Point[]) {
  if (points.length < 2) return 0;
  const start = points[0]!;
  const end = points[points.length - 1]!;
  const sign = Math.sign(end.x - start.x);
  if (sign === 0) return 0;

  let back = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (a.y !== b.y) continue;
    const dx = b.x - a.x;
    const s = Math.sign(dx);
    if (s !== 0 && s !== sign) back++;
  }
  return back;
}

function chooseChildSideSql(
  child: { x: number; y: number },
  parent: { x: number; y: number },
  preferHorizontal: boolean,
): Side {
  const dx = parent.x - child.x;
  const dy = parent.y - child.y;
  if (preferHorizontal) return dx >= 0 ? "EAST" : "WEST";
  return dy >= 0 ? "SOUTH" : "NORTH";
}

function baseAlongForSideSql(table: Table, side: Side, columnName: string) {
  const idx = Math.max(
    0,
    table.columns.findIndex((c) => c.name === columnName),
  );
  const h = getTableHeight(table);

  if (side === "EAST" || side === "WEST") {
    const y =
      TABLE_HEADER_HEIGHT + idx * TABLE_ROW_HEIGHT + TABLE_ROW_HEIGHT / 2;
    return clamp(
      y,
      TABLE_HEADER_HEIGHT + TABLE_ROW_HEIGHT / 2,
      h - TABLE_ROW_HEIGHT / 2,
    );
  }

  const x = 18 + idx * 18;
  return clamp(x, 18, TABLE_WIDTH - 18);
}

function quant(v: number, q = 10) {
  return Math.round(v / q) * q;
}

function longHorizontalSegmentKeys(points: Point[], minLen = 160) {
  const keys: string[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (a.y !== b.y) continue;

    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    if (x1 - x0 < minLen) continue;

    keys.push(`H|${quant(a.y, 10)}|${quant(x0, 20)}|${quant(x1, 20)}`);
  }
  return keys;
}

function buildHorizontalCandidates(
  start: Point,
  end: Point,
  laneOffset: number,
  preferBus: boolean,
) {
  const signX = Math.sign(end.x - start.x);
  if (signX === 0) return [];

  const LANE_GAP = 46;
  const off = clamp(laneOffset, -8, 8);

  const baseLead = 36;
  const lead = clamp(baseLead + Math.abs(off) * 10, 36, 140);

  const sLead = { x: start.x + signX * lead, y: start.y };
  const eLead = { x: end.x - signX * lead, y: end.y };

  const laneY = off * LANE_GAP;

  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  const busNearEnd = end.y + laneY;
  const busMid = (start.y + end.y) / 2 + laneY * 0.55;
  const busAbove = minY - 120 + laneY;
  const busBelow = maxY + 120 + laneY;

  const busYs = [busNearEnd, busMid, busAbove, busBelow];

  const zRoute = simplifyOrthogonal([
    start,
    sLead,
    { x: eLead.x, y: sLead.y },
    eLead,
    end,
  ]);
  const buses = busYs.map((y) =>
    simplifyOrthogonal([
      start,
      sLead,
      { x: sLead.x, y },
      { x: eLead.x, y },
      eLead,
      end,
    ]),
  );

  return preferBus ? [...buses, zRoute] : [zRoute, ...buses];
}

function bestHorizontalReroute(
  original: Point[],
  laneOffset: number,
  obstacles: Rect[],
  preferBus: boolean,
  allowLongerFactor: number,
) {
  if (original.length < 2) return null;

  const start = original[0]!;
  const end = original[original.length - 1]!;
  if (Math.sign(end.x - start.x) === 0) return null;

  const orig = {
    back: backtracksX(original),
    hits: intersectionHits(original, obstacles),
    len: pathLength(original),
    bends: original.length,
  };

  const candidates = buildHorizontalCandidates(
    start,
    end,
    laneOffset,
    preferBus,
  );

  let best: {
    pts: Point[];
    back: number;
    hits: number;
    len: number;
    bends: number;
  } | null = null;

  for (const pts0 of candidates) {
    const pts = simplifyOrthogonal(pts0);

    const score = {
      back: backtracksX(pts),
      hits: intersectionHits(pts, obstacles),
      len: pathLength(pts),
      bends: pts.length,
    };

    if (score.hits > orig.hits) continue;
    if (orig.back === 0 && score.back !== 0) continue;
    if (orig.back > 0 && score.back > orig.back) continue;

    if (score.bends > Math.max(orig.bends, 7)) continue;
    if (score.len > orig.len * allowLongerFactor) continue;

    if (!best) best = { pts, ...score };
    else {
      if (score.hits < best.hits) best = { pts, ...score };
      else if (score.hits === best.hits && score.back < best.back)
        best = { pts, ...score };
      else if (
        score.hits === best.hits &&
        score.back === best.back &&
        score.bends < best.bends
      )
        best = { pts, ...score };
      else if (
        score.hits === best.hits &&
        score.back === best.back &&
        score.bends === best.bends &&
        score.len < best.len
      )
        best = { pts, ...score };
    }
  }

  return best?.pts ?? null;
}

export async function buildSqlLayout(
  elk: ELK,
  tables: Table[],
  relations: Relation[],
  options: { availableWidth: number; direction: LayoutDirection },
): Promise<{
  layout: Record<string, Layout>;
  edges: RoutedEdge[];
  size: { width: number; height: number };
}> {
  const tableByName = new Map(tables.map((t) => [t.name, t]));
  const portMeta = new Map<
    string,
    { laneOffset: number; laneCount: number; side: Side }
  >();

  const elkDirection = options.direction === "vertical" ? "DOWN" : "RIGHT";
  const preferHorizontal = elkDirection === "RIGHT";

  const targetWrapWidth = Math.max(
    560,
    Math.floor((options.availableWidth - LAYOUT_PADDING * 2) * 0.98),
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
      return { id: `pre:${i}`, sources: [r.toTable], targets: [r.fromTable] };
    })
    .filter(Boolean);

  const preGraph: any = {
    id: "preRoot",
    children: preNodes,
    edges: preEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": elkDirection,
      "elk.edgeRouting": "POLYLINE",
      "elk.layered.unnecessaryBendpoints": "true",
      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,
      "elk.spacing.nodeNode": "52",
      "elk.layered.spacing.nodeNodeBetweenLayers": preferHorizontal
        ? "134"
        : "162",
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

  type Endpoint = {
    relIndex: number;
    tableName: string;
    columnName: string;
    side: Side;
    portId: string;
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

    const childSide = chooseChildSideSql(
      childCenter,
      parentCenter,
      preferHorizontal,
    );
    const parentSide = oppositeSide(childSide);

    endpoints.push({
      relIndex: i,
      tableName: r.fromTable,
      columnName: r.fromColumn,
      side: childSide,
      baseAlong: baseAlongForSideSql(child, childSide, r.fromColumn),
      portId: `port:child:${i}`,
    });

    endpoints.push({
      relIndex: i,
      tableName: r.toTable,
      columnName: r.toColumn,
      side: parentSide,
      baseAlong: baseAlongForSideSql(parent, parentSide, r.toColumn),
      portId: `port:parent:${i}`,
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
      const minGap = clamp(Math.round(span / (group.length + 1)), 26, 44);

      const ys = nudgeToMinGap(bases, minY, maxY, minGap);
      const cx = side === "EAST" ? TABLE_WIDTH : 0;

      for (let i = 0; i < group.length; i++) {
        const ep = group[i]!;
        portCenters.set(ep.portId, { x: cx, y: ys[i]!, side });
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
      const minGap = clamp(Math.round(span / (group.length + 1)), 26, 44);

      const xs = nudgeToMinGap(bases, minX, maxX, minGap);
      const cy = side === "SOUTH" ? h : 0;

      for (let i = 0; i < group.length; i++) {
        const ep = group[i]!;
        portCenters.set(ep.portId, { x: xs[i]!, y: cy, side });
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
    const margin = d >= 10 ? 50 : d >= 6 ? 40 : 30;

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
    id: "sqlRoot",
    children: elkNodes,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": elkDirection,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.unnecessaryBendpoints": "true",
      "elk.orthogonalRouting.minimumSegmentLength": preferHorizontal
        ? "40"
        : "56",
      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,
      "elk.spacing.nodeNode": "52",
      "elk.layered.spacing.nodeNodeBetweenLayers": preferHorizontal
        ? "136"
        : "166",
      "elk.spacing.edgeEdge": "28",
      "elk.spacing.edgeNode": "44",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "32",
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
      x: Math.round(n.x ?? 0),
      y: Math.round(n.y ?? 0),
      width: Math.round(n.width ?? TABLE_WIDTH),
      height: Math.round(n.height ?? 0),
    };
  }

  const rects: Rect[] = Object.values(layout).map((b) => ({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
  }));
  const obstacles = rects.map((r) => inflateRect(r, 12));

  const rawEdgesWithIndex: Array<RoutedEdge & { relIndex: number }> = (
    out.edges ?? []
  )
    .map((e: any) => {
      const relIndex = Number(String(e.id).split(":")[1]);
      const relation = relations[relIndex];
      if (!relation) return null;

      let pts = pointsFromElkEdge(e);
      if (!pts) return null;

      pts = pts.slice().reverse();
      pts = simplifyOrthogonal(pts);

      const BASE_LEAD = 34;
      const STEP_LEAD = 12;
      const MAX_LEAD = 170;

      const sm = portMeta.get(`port:child:${relIndex}`);
      const em = portMeta.get(`port:parent:${relIndex}`);

      if (sm) {
        const desired = clamp(
          BASE_LEAD + Math.abs(sm.laneOffset) * STEP_LEAD,
          BASE_LEAD,
          MAX_LEAD,
        );
        pts = extendLeadWithoutExtraBends(pts, sm.side, "start", desired);
      }
      if (em) {
        const desired = clamp(
          BASE_LEAD + Math.abs(em.laneOffset) * STEP_LEAD,
          BASE_LEAD,
          MAX_LEAD,
        );
        pts = extendLeadWithoutExtraBends(pts, em.side, "end", desired);
      }

      pts = ensureMinEndpointLegs(pts, preferHorizontal ? 40 : 54);
      pts = simplifyOrthogonal(pts);

      return { id: e.id, relation, points: pts, relIndex };
    })
    .filter(Boolean);

  const segCounts = new Map<string, number>();
  if (options.direction === "horizontal") {
    for (const ed of rawEdgesWithIndex) {
      for (const k of longHorizontalSegmentKeys(ed.points)) {
        segCounts.set(k, (segCounts.get(k) ?? 0) + 1);
      }
    }
  }

  // Lane offsets per target+side, sorted by target port Y to avoid crossings near the target
  const laneOffsetByRelIndex = new Map<number, number>();
  if (options.direction === "horizontal") {
    const groups = new Map<string, number[]>();
    for (const ed of rawEdgesWithIndex) {
      const relIndex = ed.relIndex;
      const to = ed.relation.toTable;
      const endPort = portMeta.get(`port:parent:${relIndex}`);
      const side = endPort?.side ?? "EAST";
      const key = `${to}|${side}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(relIndex);
    }

    for (const [, list] of groups.entries()) {
      list.sort((a, b) => {
        const ya = portCenters.get(`port:parent:${a}`)?.y ?? 0;
        const yb = portCenters.get(`port:parent:${b}`)?.y ?? 0;
        return ya - yb || a - b;
      });
      const mid = Math.floor((list.length - 1) / 2);
      for (let i = 0; i < list.length; i++)
        laneOffsetByRelIndex.set(list[i]!, i - mid);
    }
  }

  let routedEdges: RoutedEdge[] = rawEdgesWithIndex.map((e) => ({
    id: e.id,
    relation: e.relation,
    points: e.points,
  }));

  if (options.direction === "horizontal") {
    routedEdges = rawEdgesWithIndex.map((ed) => {
      const back = backtracksX(ed.points);
      const overlap = longHorizontalSegmentKeys(ed.points).some(
        (k) => (segCounts.get(k) ?? 0) > 1,
      );

      if (!back && !overlap)
        return { id: ed.id, relation: ed.relation, points: ed.points };

      const laneOffset = laneOffsetByRelIndex.get(ed.relIndex) ?? 0;
      const allowLonger = overlap ? 1.55 : 1.28;

      const cand = bestHorizontalReroute(
        ed.points,
        laneOffset,
        obstacles,
        true,
        allowLonger,
      );

      return { id: ed.id, relation: ed.relation, points: cand ?? ed.points };
    });
  }

  const size = normalizeWithPadding(layout, routedEdges);
  return { layout, edges: routedEdges, size };
}
