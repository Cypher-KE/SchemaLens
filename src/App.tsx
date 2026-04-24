import { useMemo, useState, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { ParseResult } from "./types";
import { parseSchema, buildLayout, SAMPLE_SCHEMA } from "./utils/schemaParser";

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

  const exportAsImage = async () => {
    if (!canvasRef.current) return;
    try {
      const dataUrl = await toPng(canvasRef.current, {
        cacheBust: true,
        backgroundColor: "#020617",
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
        backgroundColor: "#020617",
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
    return result.tables.filter((table) =>
      table.name.toLowerCase().includes(term),
    );
  }, [result.tables, search]);

  const layout = useMemo(() => buildLayout(filteredTables), [filteredTables]);

  const canvasSize = useMemo(() => {
    const values = Object.values(layout);
    const width = values.length
      ? Math.max(...values.map((item) => item.x + item.width)) + 72
      : 720;
    const height = values.length
      ? Math.max(...values.map((item) => item.y + item.height)) + 72
      : 500;
    return { width, height };
  }, [layout]);

  const parsedSummary = `${result.tables.length} tables • ${result.relations.length} relations`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col lg:flex-row">
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

        <main className="relative flex-1 overflow-auto bg-[radial-gradient(circle_at_top_left,_#1e293b_0%,_#0f172a_45%,_#020617_100%)] p-5 lg:p-8">
          <div
            ref={canvasRef}
            className="relative"
            style={{
              width: `${canvasSize.width}px`,
              minHeight: `${canvasSize.height}px`,
            }}
          >
            <RelationLayer
              tables={filteredTables}
              layout={layout}
              relations={result.relations.filter(
                (relation) =>
                  layout[relation.fromTable] && layout[relation.toTable],
              )}
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
                      setActiveTable((current) =>
                        current === table.name ? null : table.name,
                      )
                    }
                  />
                );
              })}
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
