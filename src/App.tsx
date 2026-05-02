import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import { AnimatePresence } from "framer-motion";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import type {
  DiagramFormat,
  Layout,
  LayoutDirection,
  ParseResult,
  RoutedEdge,
} from "./types";
import {
  parseSchema,
  buildLayout,
  SAMPLE_SCHEMA,
  LAYOUT_PADDING,
  LAYOUT_GAP_X,
  LAYOUT_GAP_Y,
} from "./utils/schemaParser";
import { buildOptimalLayoutElk } from "./utils/elkLayout";
import { parseErdDiagram, SAMPLE_ERD } from "./utils/erdParser";

import Sidebar from "./components/Sidebar";
import RelationLayer from "./components/RelationLayer";
import TableCard from "./components/TableCard";

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

export default function App() {
  const [format, setFormat] = useState<DiagramFormat>("sql");

  const [sqlDirection, setSqlDirection] =
    useState<LayoutDirection>("horizontal");
  const [erdDirection, setErdDirection] = useState<LayoutDirection>("vertical");

  const [schemaText, setSchemaText] = useState(SAMPLE_SCHEMA);
  const [search, setSearch] = useState("");
  const [activeTable, setActiveTable] = useState<string | null>(null);

  const [result, setResult] = useState<ParseResult>(() =>
    parseSchema(SAMPLE_SCHEMA),
  );

  const canvasRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [mainWidth, setMainWidth] = useState(1200);

  const [layout, setLayout] = useState<Record<string, Layout>>({});
  const [routes, setRoutes] = useState<RoutedEdge[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 720, height: 500 });

  const mode = (result.format ?? format) as DiagramFormat;
  const directionForLayout = mode === "erd" ? erdDirection : sqlDirection;

  useLayoutEffect(() => {
    if (!mainRef.current) return;
    const ro = new ResizeObserver(([entry]) =>
      setMainWidth(entry.contentRect.width),
    );
    ro.observe(mainRef.current);
    return () => ro.disconnect();
  }, []);

  const getExportBg = () => {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--export-bg")
      .trim();
    return raw ? `hsl(${raw})` : "#272822";
  };

  const exportAsImage = async () => {
    if (!canvasRef.current) return;
    try {
      const dataUrl = await toPng(canvasRef.current, {
        cacheBust: true,
        backgroundColor: getExportBg(),
      });
      const link = document.createElement("a");
      link.download = "database-diagram.png";
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Failed to export image", err);
    }
  };

  const exportAsPDF = async () => {
    if (!canvasRef.current) return;
    try {
      const dataUrl = await toPng(canvasRef.current, {
        cacheBust: true,
        backgroundColor: getExportBg(),
      });
      const imgProps = new jsPDF().getImageProperties(dataUrl);
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

      pdf.addImage(dataUrl, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save("database-diagram.pdf");
    } catch (err) {
      console.error("Failed to export PDF", err);
    }
  };

  const filteredTables = useMemo(() => {
    if (!search.trim()) return result.tables;
    const term = search.toLowerCase();
    return result.tables.filter((t) => t.name.toLowerCase().includes(term));
  }, [result.tables, search]);

  const filteredTableSet = useMemo(
    () => new Set(filteredTables.map((t) => t.name)),
    [filteredTables],
  );

  const filteredRelations = useMemo(
    () =>
      result.relations.filter(
        (r) =>
          filteredTableSet.has(r.fromTable) && filteredTableSet.has(r.toTable),
      ),
    [result.relations, filteredTableSet],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const out = await buildOptimalLayoutElk(
          filteredTables,
          filteredRelations,
          {
            availableWidth: mainWidth - 64,
            mode,
            direction: directionForLayout,
          },
        );

        if (cancelled) return;
        setLayout(out.layout);
        setRoutes(out.edges);
        setCanvasSize(out.size);
      } catch (e) {
        console.error("ELK layout failed; falling back to grid layout", e);

        const fallbackLayout = buildLayout(filteredTables, {
          availableWidth: mainWidth - 64,
          relations: filteredRelations,
        });

        const values = Object.values(fallbackLayout);
        const maxX = values.length
          ? Math.max(...values.map((b) => b.x + b.width))
          : 0;
        const maxY = values.length
          ? Math.max(...values.map((b) => b.y + b.height))
          : 0;

        const EXTRA_X = Math.max(120, LAYOUT_GAP_X);
        const EXTRA_Y = Math.max(120, LAYOUT_GAP_Y);

        if (cancelled) return;
        setLayout(fallbackLayout);
        setRoutes([]);
        setCanvasSize({
          width: values.length ? maxX + LAYOUT_PADDING + EXTRA_X : 720,
          height: values.length ? maxY + LAYOUT_PADDING + EXTRA_Y : 500,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filteredTables, filteredRelations, mainWidth, mode, directionForLayout]);

  const parsedSummary = `${result.tables.length} tables • ${result.relations.length} relations • ${mode} • ${directionForLayout}`;

  const visualize = () => {
    const trimmed = schemaText.trim();
    const autoIsErd = /^erDiagram\b/i.test(trimmed);
    const chosen: DiagramFormat = autoIsErd ? "erd" : format;

    const next =
      chosen === "erd" ? parseErdDiagram(schemaText) : parseSchema(schemaText);

    setResult(next);
    setActiveTable(null);
    if (autoIsErd && format !== "erd") setFormat("erd");
    if (!autoIsErd && format !== "sql") setFormat("sql");
  };

  const loadSample = () => {
    if (format === "erd") {
      setSchemaText(SAMPLE_ERD);
      setResult(parseErdDiagram(SAMPLE_ERD));
    } else {
      setSchemaText(SAMPLE_SCHEMA);
      setResult(parseSchema(SAMPLE_SCHEMA));
    }
    setSearch("");
    setActiveTable(null);
  };

  // playground (pan/zoom)
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  useEffect(() => void (zoomRef.current = zoom), [zoom]);
  useEffect(() => void (panRef.current = pan), [pan]);

  const [spaceDown, setSpaceDown] = useState(false);
  const spaceDownRef = useRef(false);
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      spaceDownRef.current = true;
      setSpaceDown(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      spaceDownRef.current = false;
      setSpaceDown(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  const setZoomSafe = useCallback((next: number) => {
    zoomRef.current = next;
    setZoom(next);
  }, []);

  const setPanSafe = useCallback((next: { x: number; y: number }) => {
    panRef.current = next;
    setPan(next);
  }, []);

  const resetView = useCallback(() => {
    const el = mainRef.current;
    if (!el) {
      setZoomSafe(1);
      setPanSafe({ x: 0, y: 0 });
      return;
    }

    const w = el.clientWidth;
    const h = el.clientHeight;

    const x = Math.max(12, Math.round((w - canvasSize.width) / 2));
    const y = Math.max(12, Math.round((h - canvasSize.height) / 2));

    setZoomSafe(1);
    setPanSafe({ x, y });
  }, [canvasSize.height, canvasSize.width, setPanSafe, setZoomSafe]);

  useEffect(() => {
    resetView();
  }, [canvasSize.width, canvasSize.height, resetView]);

  const zoomAtClient = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const el = mainRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;

      const s = zoomRef.current;
      const p = panRef.current;

      const nextZoom = clamp(s * factor, 0.2, 3.2);
      const wx = (mx - p.x) / s;
      const wy = (my - p.y) / s;

      const nextPan = {
        x: mx - wx * nextZoom,
        y: my - wy * nextZoom,
      };

      setZoomSafe(nextZoom);
      setPanSafe(nextPan);
    },
    [setPanSafe, setZoomSafe],
  );

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = 1.085;
      const factor = e.deltaY > 0 ? 1 / step : step;
      zoomAtClient(e.clientX, e.clientY, factor);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAtClient]);

  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    const wantPan = e.button === 1 || e.button === 2 || spaceDownRef.current;
    if (!wantPan) return;

    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    isPanningRef.current = true;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    e.preventDefault();

    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;

    setPanSafe({
      x: panStartRef.current.panX + dx,
      y: panStartRef.current.panY + dy,
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    e.preventDefault();
    isPanningRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const directionForSidebar = format === "erd" ? erdDirection : sqlDirection;
  const setDirectionForSidebar = (d: LayoutDirection) => {
    if (format === "erd") setErdDirection(d);
    else setSqlDirection(d);
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "hsl(var(--bg))", color: "hsl(var(--fg))" }}
    >
      <div className="flex min-h-screen w-full flex-col lg:flex-row">
        <Sidebar
          schemaText={schemaText}
          setSchemaText={setSchemaText}
          format={format}
          setFormat={setFormat}
          direction={directionForSidebar}
          setDirection={setDirectionForSidebar}
          search={search}
          setSearch={setSearch}
          activeTable={activeTable}
          setActiveTable={setActiveTable}
          parsedSummary={parsedSummary}
          onVisualize={visualize}
          onLoadSample={loadSample}
          onExportImage={exportAsImage}
          onExportPDF={exportAsPDF}
        />

        <main
          ref={mainRef}
          className="canvas-bg relative flex-1 overflow-hidden p-4 lg:p-6"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => {
            if (spaceDown) e.preventDefault();
          }}
          onDoubleClick={resetView}
        >
          <div
            className="pointer-events-auto absolute right-4 top-4 z-10 inline-flex items-center gap-2 rounded-lg border px-2 py-2"
            style={{
              borderColor: "hsl(var(--border) / 0.7)",
              background: "hsl(var(--card) / 0.55)",
              backdropFilter: "blur(10px)",
            }}
          >
            <button
              className="rounded-md border px-2 py-1 text-xs font-semibold"
              style={{
                borderColor: "hsl(var(--border) / 0.7)",
                color: "hsl(var(--fg))",
                background: "hsl(var(--bg) / 0.25)",
              }}
              onClick={() => {
                const el = mainRef.current;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                zoomAtClient(
                  rect.left + rect.width / 2,
                  rect.top + rect.height / 2,
                  1 / 1.12,
                );
              }}
            >
              −
            </button>

            <div
              className="min-w-[64px] text-center text-xs"
              style={{ color: "hsl(var(--muted-fg))" }}
            >
              {Math.round(zoom * 100)}%
            </div>

            <button
              className="rounded-md border px-2 py-1 text-xs font-semibold"
              style={{
                borderColor: "hsl(var(--border) / 0.7)",
                color: "hsl(var(--fg))",
                background: "hsl(var(--bg) / 0.25)",
              }}
              onClick={() => {
                const el = mainRef.current;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                zoomAtClient(
                  rect.left + rect.width / 2,
                  rect.top + rect.height / 2,
                  1.12,
                );
              }}
            >
              +
            </button>

            <button
              className="ml-1 rounded-md border px-2 py-1 text-xs font-semibold"
              style={{
                borderColor: "hsl(var(--border) / 0.7)",
                color: "hsl(var(--fg))",
                background: "hsl(var(--bg) / 0.25)",
              }}
              onClick={resetView}
              title="Reset view (double-click canvas)"
            >
              Reset
            </button>
          </div>

          <div
            className="absolute left-0 top-0"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
              cursor: spaceDown
                ? isPanningRef.current
                  ? "grabbing"
                  : "grab"
                : "default",
            }}
          >
            <div
              ref={canvasRef}
              className="relative"
              style={{
                width: `${canvasSize.width}px`,
                height: `${canvasSize.height}px`,
              }}
            >
              <RelationLayer
                mode={mode}
                tables={filteredTables}
                layout={layout}
                relations={filteredRelations}
                activeTable={activeTable}
                routes={routes}
              />

              <AnimatePresence>
                {filteredTables.map((table, index) => {
                  const box = layout[table.name];
                  if (!box) return null;

                  return (
                    <TableCard
                      key={table.name}
                      table={table}
                      layoutBox={box}
                      index={index}
                      mode={mode}
                      isActive={!activeTable || activeTable === table.name}
                      onToggleActive={() =>
                        setActiveTable((cur) =>
                          cur === table.name ? null : table.name,
                        )
                      }
                    />
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
