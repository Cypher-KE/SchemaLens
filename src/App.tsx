import { useMemo, useRef, useState, useLayoutEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { ParseResult } from "./types";
import {
  parseSchema,
  buildLayout,
  SAMPLE_SCHEMA,
  LAYOUT_PADDING,
  LAYOUT_GAP_X,
  LAYOUT_GAP_Y,
} from "./utils/schemaParser";

import Sidebar from "./components/Sidebar";
import RelationLayer from "./components/RelationLayer";
import TableCard from "./components/TableCard";

export default function App() {
  const [schemaText, setSchemaText] = useState(SAMPLE_SCHEMA);
  const [search, setSearch] = useState("");
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult>(() =>
    parseSchema(SAMPLE_SCHEMA),
  );

  const canvasRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [mainWidth, setMainWidth] = useState(1200);

  useLayoutEffect(() => {
    if (!mainRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setMainWidth(entry.contentRect.width);
    });
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
      link.download = "database-schema.png";
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
      pdf.save("database-schema.pdf");
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

  const layout = useMemo(
    () =>
      buildLayout(filteredTables, {
        availableWidth: mainWidth - 64,
        relations: filteredRelations,
      }),
    [filteredTables, filteredRelations, mainWidth],
  );

  const visibleRelations = useMemo(
    () =>
      filteredRelations.filter((r) => layout[r.fromTable] && layout[r.toTable]),
    [filteredRelations, layout],
  );

  const canvasSize = useMemo(() => {
    const values = Object.values(layout);
    const maxX = values.length
      ? Math.max(...values.map((b) => b.x + b.width))
      : 0;
    const maxY = values.length
      ? Math.max(...values.map((b) => b.y + b.height))
      : 0;

    // extra padding so any “outer channel” routing never gets clipped
    const EXTRA_X = Math.max(120, LAYOUT_GAP_X);
    const EXTRA_Y = Math.max(120, LAYOUT_GAP_Y);

    return {
      width: values.length ? maxX + LAYOUT_PADDING + EXTRA_X : 720,
      height: values.length ? maxY + LAYOUT_PADDING + EXTRA_Y : 500,
    };
  }, [layout]);

  const parsedSummary = `${result.tables.length} tables • ${result.relations.length} relations`;

  return (
    <div
      className="min-h-screen"
      style={{ background: "hsl(var(--bg))", color: "hsl(var(--fg))" }}
    >
      <div className="flex min-h-screen w-full flex-col lg:flex-row">
        <Sidebar
          schemaText={schemaText}
          setSchemaText={setSchemaText}
          search={search}
          setSearch={setSearch}
          activeTable={activeTable}
          setActiveTable={setActiveTable}
          parsedSummary={parsedSummary}
          onVisualize={() => {
            setResult(parseSchema(schemaText));
            setActiveTable(null);
          }}
          onLoadSample={() => {
            setSchemaText(SAMPLE_SCHEMA);
            setResult(parseSchema(SAMPLE_SCHEMA));
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
                tables={filteredTables}
                layout={layout}
                relations={visibleRelations}
                activeTable={activeTable}
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
