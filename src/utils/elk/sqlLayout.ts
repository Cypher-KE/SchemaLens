import type ELK from "elkjs/lib/elk.bundled.js";
import type {
  Layout,
  LayoutDirection,
  Relation,
  RoutedEdge,
  Table,
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
  ensureMinEndpointLegs,
  extendLeadWithoutExtraBends,
  nudgeToMinGap,
  normalizeWithPadding,
  oppositeSide,
  pointsFromElkEdge,
  simplifyOrthogonal,
  type Side,
} from "./common";

const PORT_SIZE = 2;

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

  const x = 28 + idx * 18;
  return clamp(x, 22, TABLE_WIDTH - 22);
}

function laneOrderFromOffset(laneOffset: number) {
  return Math.abs(laneOffset);
}

function fanOutEndpoint(
  points: { x: number; y: number }[],
  which: "start" | "end",
  meta: { laneOffset: number; side: Side } | undefined,
  enabled: boolean,
) {
  if (!enabled || !meta) return points;

  const off = clamp(meta.laneOffset, -4, 4);
  if (off === 0) return points;

  const step = 14;
  const delta = off * step;

  const pts = points.map((p) => ({ ...p }));
  if (pts.length < 2) return pts;

  if (which === "start") {
    const p0 = pts[0];
    const p1 = pts[1];

    if (p0.x === p1.x && (meta.side === "NORTH" || meta.side === "SOUTH")) {
      const x = p0.x + delta;
      return simplifyOrthogonal([
        p0,
        { x, y: p0.y },
        { x, y: p1.y },
        ...pts.slice(1),
      ]);
    }

    if (p0.y === p1.y && (meta.side === "EAST" || meta.side === "WEST")) {
      const y = p0.y + delta;
      return simplifyOrthogonal([
        p0,
        { x: p0.x, y },
        { x: p1.x, y },
        ...pts.slice(1),
      ]);
    }

    return pts;
  }

  const n = pts.length;
  const p0 = pts[n - 2];
  const p1 = pts[n - 1];

  if (p0.x === p1.x && (meta.side === "NORTH" || meta.side === "SOUTH")) {
    const x = p1.x + delta;
    return simplifyOrthogonal([
      ...pts.slice(0, n - 1),
      { x, y: p0.y },
      { x, y: p1.y },
      p1,
    ]);
  }

  if (p0.y === p1.y && (meta.side === "EAST" || meta.side === "WEST")) {
    const y = p1.y + delta;
    return simplifyOrthogonal([
      ...pts.slice(0, n - 1),
      { x: p0.x, y },
      { x: p1.x, y },
      p1,
    ]);
  }

  return pts;
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
  const enableFanOut = !preferHorizontal;

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
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": preferHorizontal
        ? "120"
        : "140",
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
      kind: "child",
    });

    endpoints.push({
      relIndex: i,
      tableName: r.toTable,
      columnName: r.toColumn,
      side: parentSide,
      baseAlong: baseAlongForSideSql(parent, parentSide, r.toColumn),
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
      const minGap = clamp(Math.round(span / (group.length + 1)), 16, 26);

      const ys = nudgeToMinGap(bases, minY, maxY, minGap);
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
      const minX = 20;
      const maxX = TABLE_WIDTH - 20;

      const bases = group.map((g) => g.baseAlong);
      const span = Math.max(0, maxX - minX);
      const minGap = clamp(Math.round(span / (group.length + 1)), 18, 34);

      const xs = nudgeToMinGap(bases, minX, maxX, minGap);
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
    const margin = d >= 10 ? 52 : d >= 6 ? 40 : 30;

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
        : "52",

      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,

      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": preferHorizontal
        ? "126"
        : "148",

      "elk.spacing.edgeEdge": enableFanOut ? "34" : "26",
      "elk.spacing.edgeNode": enableFanOut ? "46" : "40",
      "elk.layered.spacing.edgeEdgeBetweenLayers": enableFanOut ? "38" : "30",

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

  const routed: RoutedEdge[] = (out.edges ?? [])
    .map((e: any) => {
      const idx = Number(String(e.id).split(":")[1]);
      const relation = relations[idx];
      if (!relation) return null;

      let pts = pointsFromElkEdge(e);
      if (!pts) return null;

      pts = pts.slice().reverse();
      pts = simplifyOrthogonal(pts);

      const BASE_LEAD = preferHorizontal ? 34 : 44;
      const STEP_LEAD = preferHorizontal ? 10 : 16;
      const MAX_LEAD = preferHorizontal ? 120 : 170;

      const sm = portMeta.get(`port:child:${idx}`);
      const em = portMeta.get(`port:parent:${idx}`);

      if (sm) {
        const order = laneOrderFromOffset(sm.laneOffset);
        const desiredLead = clamp(
          BASE_LEAD + order * STEP_LEAD,
          BASE_LEAD,
          MAX_LEAD,
        );
        pts = extendLeadWithoutExtraBends(pts, "start", desiredLead);
      }

      if (em) {
        const order = laneOrderFromOffset(em.laneOffset);
        const desiredLead = clamp(
          BASE_LEAD + order * STEP_LEAD,
          BASE_LEAD,
          MAX_LEAD,
        );
        pts = extendLeadWithoutExtraBends(pts, "end", desiredLead);
      }

      pts = fanOutEndpoint(
        pts,
        "start",
        sm ? { laneOffset: sm.laneOffset, side: sm.side } : undefined,
        enableFanOut,
      );
      pts = fanOutEndpoint(
        pts,
        "end",
        em ? { laneOffset: em.laneOffset, side: em.side } : undefined,
        enableFanOut,
      );

      pts = ensureMinEndpointLegs(pts, preferHorizontal ? 40 : 48);
      pts = simplifyOrthogonal(pts);

      return { id: e.id, relation, points: pts } satisfies RoutedEdge;
    })
    .filter(Boolean);

  const size = normalizeWithPadding(layout, routed);
  return { layout, edges: routed, size };
}
