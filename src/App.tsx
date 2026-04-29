import { useMemo, useRef, useState, useLayoutEffect, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import type {
  DiagramFormat,
  ErdLayoutMode,
  Layout,
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

export default function App() {
  const [format, setFormat] = useState<DiagramFormat>("sql");
  const [erdLayout, setErdLayout] = useState<ErdLayoutMode>("hierarchical");

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
    return raw ? `hsl(${raw})` : "#0b1220";
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

  const mode = (result.format ?? format) as DiagramFormat;

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
            erdLayout,
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
  }, [filteredTables, filteredRelations, mainWidth, mode, erdLayout]);

  const parsedSummary =
    mode === "erd"
      ? `${result.tables.length} tables • ${result.relations.length} relations • erd • ${erdLayout}`
      : `${result.tables.length} tables • ${result.relations.length} relations • sql`;

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
          erdLayout={erdLayout}
          setErdLayout={setErdLayout}
          search={search}
          setSearch={setSearch}
          activeTable={activeTable}
          setActiveTable={setActiveTable}
          parsedSummary={parsedSummary}
          onVisualize={visualize}
          onLoadSampleSql={() => {
            setFormat("sql");
            setSchemaText(SAMPLE_SCHEMA);
            setResult(parseSchema(SAMPLE_SCHEMA));
            setSearch("");
            setActiveTable(null);
          }}
          onLoadSampleErd={() => {
            setFormat("erd");
            setSchemaText(SAMPLE_ERD);
            setResult(parseErdDiagram(SAMPLE_ERD));
            setSearch("");
            setActiveTable(null);
          }}
          onExportImage={exportAsImage}
          onExportPDF={exportAsPDF}
        />

        <main
          ref={mainRef}
          className="canvas-bg relative flex-1 overflow-auto p-4 lg:p-6"
        >
          <div className="relative mx-auto w-fit">
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
