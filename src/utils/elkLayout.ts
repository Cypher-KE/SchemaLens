import ELK from "elkjs/lib/elk.bundled.js";
import type {
  DiagramFormat,
  ErdLayoutMode,
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

function extendLeadWithoutExtraBends(
  points: Point[],
  side: Side,
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
  } else {
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
}

function ensureMinEndpointLegs(points: Point[], minLeg: number) {
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

function pointsFromElkEdge(e: any): Point[] | null {
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
    } else out.push(...pts);
  }

  return out.length ? simplifyOrthogonal(out) : null;
}

function normalizeWithPadding(
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

function orderErdNodes(tables: Table[], relations: Relation[]) {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  const undirected = new Map<string, Set<string>>();

  for (const t of tables) {
    outDeg.set(t.name, 0);
    inDeg.set(t.name, 0);
    undirected.set(t.name, new Set());
  }

  for (const r of relations) {
    if (!byName.has(r.fromTable) || !byName.has(r.toTable)) continue;
    if (r.fromTable === r.toTable) continue;

    outDeg.set(r.toTable, (outDeg.get(r.toTable) ?? 0) + 1);
    inDeg.set(r.fromTable, (inDeg.get(r.fromTable) ?? 0) + 1);

    undirected.get(r.fromTable)!.add(r.toTable);
    undirected.get(r.toTable)!.add(r.fromTable);
  }

  let root = tables[0]?.name ?? "";
  let best = -1;
  for (const [n, d] of outDeg.entries()) {
    if (d > best) {
      best = d;
      root = n;
    }
  }

  const q: string[] = root ? [root] : [];
  const seen = new Set<string>();
  const order: string[] = [];

  while (q.length) {
    const cur = q.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    order.push(cur);

    const neighbors = Array.from(undirected.get(cur) ?? []);
    neighbors.sort((a, b) => {
      const da = (outDeg.get(a) ?? 0) + (inDeg.get(a) ?? 0);
      const db = (outDeg.get(b) ?? 0) + (inDeg.get(b) ?? 0);
      if (da !== db) return db - da;
      return a.localeCompare(b);
    });

    for (const n of neighbors) q.push(n);
  }

  const remaining = tables
    .map((t) => t.name)
    .filter((n) => !seen.has(n))
    .sort((a, b) => {
      const da = (outDeg.get(a) ?? 0) + (inDeg.get(a) ?? 0);
      const db = (outDeg.get(b) ?? 0) + (inDeg.get(b) ?? 0);
      if (da !== db) return db - da;
      return a.localeCompare(b);
    });

  const finalOrder = [...order, ...remaining]
    .map((n) => byName.get(n)!)
    .filter(Boolean);
  return { ordered: finalOrder, rootName: root, inDeg, outDeg };
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

async function buildErdLayout(
  elk: ELK,
  tables: Table[],
  relations: Relation[],
  availableWidth: number,
  layoutMode: ErdLayoutMode,
): Promise<BuildElkResult> {
  const { ordered, rootName, inDeg, outDeg } = orderErdNodes(tables, relations);
  const tableByName = new Map(tables.map((t) => [t.name, t]));

  const direction = layoutMode === "hierarchical" ? "DOWN" : "RIGHT";
  const preferHorizontal = direction === "RIGHT";

  const targetWrapWidth =
    layoutMode === "adaptive"
      ? Math.max(780, Math.floor((availableWidth - LAYOUT_PADDING * 2) * 0.98))
      : Math.max(640, Math.floor((availableWidth - LAYOUT_PADDING * 2) * 0.84));

  const wrapping = layoutMode === "adaptive" ? "MULTI_EDGE" : "SINGLE_EDGE";

  const nodeNode = layoutMode === "adaptive" ? "34" : "42";
  const betweenLayers = layoutMode === "adaptive" ? "96" : "122";
  const edgeEdge = layoutMode === "adaptive" ? "24" : "28";
  const edgeNode = layoutMode === "adaptive" ? "40" : "48";
  const minSeg = layoutMode === "adaptive" ? "44" : "54";
  const endpointLeg = layoutMode === "adaptive" ? 36 : 44;

  const preNodes = ordered.map((t) => ({
    id: t.name,
    width: TABLE_WIDTH,
    height: getTableHeight(t),
  }));

  const preEdges = relations
    .map((r, i) => {
      if (!tableByName.has(r.fromTable) || !tableByName.has(r.toTable))
        return null;
      if (r.fromTable === r.toTable) return null;
      return { id: `pre:${i}`, sources: [r.toTable], targets: [r.fromTable] };
    })
    .filter(Boolean);

  const preGraph: any = {
    id: "erdPre",
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

      "elk.layered.wrapping.strategy": wrapping,
      "elk.layered.wrapping.targetWidth": String(targetWrapWidth),

      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
      "elk.layered.cycleBreaking.strategy": "GREEDY",

      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.layered.nodePlacement.favorStraightEdges": "true",

      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
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
    portId: string;
    tableName: string;
    side: Side;
    baseAlong: number;
  };

  const endpoints: Endpoint[] = [];

  relations.forEach((r, i) => {
    const childB = preBox.get(r.fromTable);
    const parentB = preBox.get(r.toTable);
    if (!childB || !parentB) return;
    if (r.fromTable === r.toTable) return;

    const childCenter = {
      x: childB.x + childB.w / 2,
      y: childB.y + childB.h / 2,
    };
    const parentCenter = {
      x: parentB.x + parentB.w / 2,
      y: parentB.y + parentB.h / 2,
    };

    const parentSide: Side = preferHorizontal ? "EAST" : "SOUTH";
    const childSide: Side = preferHorizontal ? "WEST" : "NORTH";

    const baseAlongParent =
      parentSide === "NORTH" || parentSide === "SOUTH"
        ? parentCenter.x === parentCenter.x
          ? parentCenter.x - parentB.x
          : TABLE_WIDTH / 2
        : parentCenter.y - parentB.y;

    const baseAlongChild =
      childSide === "NORTH" || childSide === "SOUTH"
        ? childCenter.x - childB.x
        : childCenter.y - childB.y;

    endpoints.push({
      portId: `erd:parent:${i}`,
      tableName: r.toTable,
      side: parentSide,
      baseAlong: baseAlongParent,
    });

    endpoints.push({
      portId: `erd:child:${i}`,
      tableName: r.fromTable,
      side: childSide,
      baseAlong: baseAlongChild,
    });
  });

  const endpointsByTableSide = new Map<string, Endpoint[]>();
  for (const ep of endpoints) {
    const key = `${ep.tableName}|${ep.side}`;
    if (!endpointsByTableSide.has(key)) endpointsByTableSide.set(key, []);
    endpointsByTableSide.get(key)!.push(ep);
  }

  const portCenters = new Map<string, { x: number; y: number; side: Side }>();

  for (const [key, group] of endpointsByTableSide.entries()) {
    group.sort((a, b) => a.baseAlong - b.baseAlong);

    const [tableName, side] = key.split("|") as [string, Side];
    const t = tableByName.get(tableName);
    if (!t) continue;

    const h = getTableHeight(t);

    if (side === "NORTH" || side === "SOUTH") {
      const minX = 24;
      const maxX = TABLE_WIDTH - 24;

      const bases = group.map((g) => g.baseAlong);
      const span = Math.max(0, maxX - minX);
      const minGap = clamp(Math.round(span / (group.length + 1)), 22, 46);

      const xs = nudgeToMinGap(bases, minX, maxX, minGap);
      const y = side === "SOUTH" ? h : 0;

      for (let i = 0; i < group.length; i++) {
        portCenters.set(group[i].portId, { x: xs[i], y, side });
      }
    } else {
      const minY = 18;
      const maxY = h - 18;

      const bases = group.map((g) => g.baseAlong);
      const span = Math.max(0, maxY - minY);
      const minGap = clamp(Math.round(span / (group.length + 1)), 22, 46);

      const ys = nudgeToMinGap(bases, minY, maxY, minGap);
      const x = side === "EAST" ? TABLE_WIDTH : 0;

      for (let i = 0; i < group.length; i++) {
        portCenters.set(group[i].portId, { x, y: ys[i], side });
      }
    }
  }

  const elkNodes = ordered.map((t) => {
    const deg = (outDeg.get(t.name) ?? 0) + (inDeg.get(t.name) ?? 0);
    const margin = deg >= 10 ? 84 : deg >= 6 ? 70 : 56;

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

    const node: any = {
      id: t.name,
      width: TABLE_WIDTH,
      height: getTableHeight(t),
      ports,
      layoutOptions: {
        "elk.portConstraints": "FIXED_POS",
        "elk.margin": `[top=${margin},left=${margin},bottom=${margin},right=${margin}]`,
      },
    };

    if ((inDeg.get(t.name) ?? 0) === 0)
      node.layoutOptions["elk.layered.layering.layerConstraint"] = "FIRST";
    if (t.name === rootName)
      node.layoutOptions["elk.layered.layering.layerConstraint"] = "FIRST";

    return node;
  });

  const elkEdges = relations
    .map((r, i) => {
      if (r.fromTable === r.toTable) return null;
      return {
        id: `edge:${i}`,
        sources: [`erd:parent:${i}`],
        targets: [`erd:child:${i}`],
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    sources: string[];
    targets: string[];
  }>;

  const graph: any = {
    id: "erdRoot",
    children: elkNodes,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.orthogonalRouting.minimumSegmentLength": minSeg,
      "elk.layered.unnecessaryBendpoints": "true",

      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,

      "elk.spacing.nodeNode": nodeNode,
      "elk.layered.spacing.nodeNodeBetweenLayers": betweenLayers,

      "elk.spacing.edgeEdge": edgeEdge,
      "elk.spacing.edgeNode": edgeNode,
      "elk.layered.spacing.edgeEdgeBetweenLayers":
        layoutMode === "adaptive" ? "26" : "34",

      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
      "elk.layered.cycleBreaking.strategy": "GREEDY",

      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.layered.nodePlacement.favorStraightEdges": "true",

      "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",

      "elk.layered.wrapping.strategy": wrapping,
      "elk.layered.wrapping.targetWidth": String(targetWrapWidth),

      "elk.layered.mergeEdges": "false",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
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
      pts = ensureMinEndpointLegs(pts, endpointLeg);
      pts = extendLeadWithoutExtraBends(
        pts,
        preferHorizontal ? "WEST" : "NORTH",
        "start",
        endpointLeg,
      );
      pts = extendLeadWithoutExtraBends(
        pts,
        preferHorizontal ? "EAST" : "SOUTH",
        "end",
        endpointLeg,
      );
      pts = simplifyOrthogonal(pts);

      return { id: e.id, relation, points: pts } satisfies RoutedEdge;
    })
    .filter(Boolean);

  const size = normalizeWithPadding(layout, routed);
  return { layout, edges: routed, size };
}

async function buildSqlLayout(
  elk: ELK,
  tables: Table[],
  relations: Relation[],
  availableWidth: number,
): Promise<BuildElkResult> {
  const tableByName = new Map(tables.map((t) => [t.name, t]));
  const portMeta = new Map<
    string,
    { laneOffset: number; laneCount: number; side: Side }
  >();

  const targetWrapWidth = Math.max(
    520,
    Math.floor((availableWidth - LAYOUT_PADDING * 2) * 0.98),
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

    const childSide = chooseChildSideSql(childCenter, parentCenter);
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
      const minGap = clamp(Math.round(span / (group.length + 1)), 8, 14);

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
      const minX = 18;
      const maxX = TABLE_WIDTH - 18;

      const bases = group.map((g) => g.baseAlong);
      const span = Math.max(0, maxX - minX);
      const minGap = clamp(Math.round(span / (group.length + 1)), 10, 18);

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
    const margin = d >= 10 ? 34 : d >= 6 ? 26 : 18;

    const ports = endpoints
      .filter((ep) => ep.tableName === t.name)
      .map((ep) => {
        const c = portCenters.get(ep.portId);
        if (!c) return null;

        const pc = portCenterForSideSql(t, c.side, ep.columnName);

        return {
          id: ep.portId,
          width: PORT_SIZE,
          height: PORT_SIZE,
          x: pc.x - PORT_SIZE / 2,
          y: pc.y - PORT_SIZE / 2,
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
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.unnecessaryBendpoints": "true",
      "elk.orthogonalRouting.minimumSegmentLength": "28",
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

      const BASE_LEAD = 26;
      const STEP_LEAD = 10;
      const MAX_LEAD = 86;

      const sm = portMeta.get(`port:child:${idx}`);
      const em = portMeta.get(`port:parent:${idx}`);

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

  const size = normalizeWithPadding(layout, routed);
  return { layout, edges: routed, size };
}

export async function buildOptimalLayoutElk(
  tables: Table[],
  relations: Relation[],
  options?: {
    availableWidth?: number;
    mode?: DiagramFormat;
    erdLayout?: ErdLayoutMode;
  },
): Promise<BuildElkResult> {
  const elk = new ELK();
  const mode: DiagramFormat = options?.mode ?? "sql";
  const availableWidth = Math.max(520, options?.availableWidth ?? 1200);

  if (mode === "erd") {
    return buildErdLayout(
      elk,
      tables,
      relations,
      availableWidth,
      options?.erdLayout ?? "hierarchical",
    );
  }

  return buildSqlLayout(elk, tables, relations, availableWidth);
}
