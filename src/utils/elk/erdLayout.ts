import type ELK from "elkjs/lib/elk.bundled.js";
import type {
  Layout,
  LayoutDirection,
  Relation,
  RoutedEdge,
  Table,
} from "../../types";
import { getTableHeight, LAYOUT_PADDING, TABLE_WIDTH } from "../schemaParser";
import {
  clamp,
  ensureMinEndpointLegs,
  extendLeadWithoutExtraBends,
  nudgeToMinGap,
  normalizeWithPadding,
  pointsFromElkEdge,
  simplifyOrthogonal,
  type Side,
} from "./common";

const PORT_SIZE = 2;

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

export async function buildErdLayout(
  elk: ELK,
  tables: Table[],
  relations: Relation[],
  options: { availableWidth: number; direction: LayoutDirection },
): Promise<{
  layout: Record<string, Layout>;
  edges: RoutedEdge[];
  size: { width: number; height: number };
}> {
  const { ordered, rootName, inDeg, outDeg } = orderErdNodes(tables, relations);
  const tableByName = new Map(tables.map((t) => [t.name, t]));

  const elkDirection = options.direction === "horizontal" ? "RIGHT" : "DOWN";
  const preferHorizontal = elkDirection === "RIGHT";

  const targetWrapWidth = Math.max(
    640,
    Math.floor((options.availableWidth - LAYOUT_PADDING * 2) * 0.84),
  );

  const wrapping = "SINGLE_EDGE";
  const nodeNode = "42";
  const betweenLayers = "122";
  const edgeEdge = "28";
  const edgeNode = "48";
  const minSeg = "54";
  const endpointLeg = 44;

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
      "elk.direction": elkDirection,
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
        ? parentCenter.x - parentB.x
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

      for (let i = 0; i < group.length; i++)
        portCenters.set(group[i].portId, { x: xs[i], y, side });
    } else {
      const minY = 18;
      const maxY = h - 18;

      const bases = group.map((g) => g.baseAlong);
      const span = Math.max(0, maxY - minY);
      const minGap = clamp(Math.round(span / (group.length + 1)), 22, 46);

      const ys = nudgeToMinGap(bases, minY, maxY, minGap);
      const x = side === "EAST" ? TABLE_WIDTH : 0;

      for (let i = 0; i < group.length; i++)
        portCenters.set(group[i].portId, { x, y: ys[i], side });
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
      "elk.direction": elkDirection,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.orthogonalRouting.minimumSegmentLength": minSeg,
      "elk.layered.unnecessaryBendpoints": "true",
      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,
      "elk.spacing.nodeNode": nodeNode,
      "elk.layered.spacing.nodeNodeBetweenLayers": betweenLayers,
      "elk.spacing.edgeEdge": edgeEdge,
      "elk.spacing.edgeNode": edgeNode,
      "elk.layered.spacing.edgeEdgeBetweenLayers": "34",
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

      pts = extendLeadWithoutExtraBends(pts, "start", endpointLeg);
      pts = extendLeadWithoutExtraBends(pts, "end", endpointLeg);
      pts = simplifyOrthogonal(pts);

      return { id: e.id, relation, points: pts } satisfies RoutedEdge;
    })
    .filter(Boolean);

  const size = normalizeWithPadding(layout, routed);
  return { layout, edges: routed, size };
}
