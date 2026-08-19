"use client";

import { useEffect, useState } from "react";

const MAX_PREVIEW_ROWS = 100;
const MAX_PREVIEW_COLUMNS = 30;
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;

interface SpreadsheetPreviewProps {
  filename: string;
  url: string;
}

interface SpreadsheetData {
  rows: string[][];
  isTruncated: boolean;
}

type PreviewState =
  | { key: string; status: "loading" }
  | { key: string; status: "ready"; data: SpreadsheetData }
  | { key: string; status: "unavailable"; message: string };

export function SpreadsheetPreview({ filename, url }: SpreadsheetPreviewProps) {
  const previewKey = `${filename}:${url}`;
  const [state, setState] = useState<PreviewState>({ key: previewKey, status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void loadSpreadsheetPreview(filename, url)
      .then((data) => {
        if (!cancelled) setState({ key: previewKey, status: "ready", data });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            key: previewKey,
            status: "unavailable",
            message: error instanceof Error ? error.message : "This spreadsheet cannot be previewed here.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filename, previewKey, url]);

  if (state.key !== previewKey || state.status === "loading") {
    return <PreviewMessage title="Loading spreadsheet…" message="Preparing a private, read-only preview." />;
  }

  if (state.status === "unavailable") {
    return <PreviewMessage title="Preview unavailable" message={state.message} />;
  }

  const [header, ...body] = state.data.rows;
  return (
    <section
      aria-label={`Preview of ${filename}`}
      tabIndex={0}
      style={{ width: "100%", height: "100%", overflow: "auto", padding: "1rem" }}
    >
      <table style={{ width: "max-content", minWidth: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "auto" }}>
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th
                key={`header-${index}`}
                scope="col"
                style={tableCellStyle({ header: true, firstColumn: index === 0 })}
              >
                {cell || `Column ${index + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {row.map((cell, columnIndex) => (
                <td key={`cell-${rowIndex}-${columnIndex}`} style={tableCellStyle({ firstColumn: columnIndex === 0 })}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {state.data.isTruncated && (
        <p style={{ margin: "0.75rem 0 0", color: "var(--text-secondary)", fontSize: "0.6875rem", lineHeight: 1.4 }}>
          Preview limited to the first {MAX_PREVIEW_ROWS} rows and {MAX_PREVIEW_COLUMNS} columns. Download to view the complete spreadsheet.
        </p>
      )}
    </section>
  );
}

function PreviewMessage({ title, message }: { title: string; message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        width: "min(28rem, calc(100% - 2rem))",
        padding: "1.5rem",
        border: "0.0625rem solid var(--border)",
        borderRadius: "0.5rem",
        background: "var(--bg-primary)",
        textAlign: "center",
      }}
    >
      <SpreadsheetGlyph />
      <p style={{ margin: "1rem 0 0", color: "var(--text-primary)", fontSize: "0.875rem", fontWeight: 650 }}>{title}</p>
      <p style={{ margin: "0.5rem 0 0", color: "var(--text-secondary)", fontSize: "0.75rem", lineHeight: 1.5 }}>{message}</p>
    </div>
  );
}

function tableCellStyle({ header = false, firstColumn = false }: { header?: boolean; firstColumn?: boolean }) {
  return {
    maxWidth: "22rem",
    overflow: "hidden",
    borderRight: "0.0625rem solid var(--border)",
    borderBottom: "0.0625rem solid var(--border)",
    background: header ? "var(--bg-primary)" : firstColumn ? "color-mix(in srgb, var(--bg-primary) 82%, var(--bg-tertiary))" : "var(--bg-secondary)",
    color: header ? "var(--text-primary)" : "var(--text-secondary)",
    fontFamily: "var(--font-mono), monospace",
    fontSize: "0.6875rem",
    fontWeight: header ? 700 : 400,
    lineHeight: 1.4,
    padding: "0.5rem 0.625rem",
    textAlign: "left" as const,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  };
}

async function loadSpreadsheetPreview(filename: string, url: string): Promise<SpreadsheetData> {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "xls") {
    throw new Error("Legacy .xls files need to be downloaded to view safely.");
  }

  const response = await fetch(url, { referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("The private spreadsheet preview could not be loaded.");

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PREVIEW_BYTES) {
    throw new Error("This spreadsheet is too large to preview here. Download it to view the complete file.");
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_PREVIEW_BYTES) {
    throw new Error("This spreadsheet is too large to preview here. Download it to view the complete file.");
  }

  if (extension === "csv") {
    return limitRows(parseCsv(new TextDecoder().decode(buffer)));
  }
  if (extension === "xlsx") {
    return parseXlsx(buffer);
  }
  if (extension === "ods") {
    return parseOds(buffer);
  }
  throw new Error("This spreadsheet format is not available for in-app preview.");
}

async function parseXlsx(buffer: ArrayBuffer): Promise<SpreadsheetData> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const sheetPath = Object.keys(zip.files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort()[0];
  if (!sheetPath) throw new Error("This workbook does not contain a previewable worksheet.");

  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsFile
    ? Array.from(parseXml(await sharedStringsFile.async("text")).getElementsByTagName("si"))
      .map((entry) => entry.textContent ?? "")
    : [];
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw new Error("This workbook does not contain a previewable worksheet.");
  const sheet = parseXml(await sheetFile.async("text"));

  const rows = Array.from(sheet.getElementsByTagName("row")).map((row) => {
    const cells: string[] = [];
    Array.from(row.getElementsByTagName("c")).forEach((cell, index) => {
      const column = columnIndex(cell.getAttribute("r")) ?? index;
      const type = cell.getAttribute("t");
      const value = cell.getElementsByTagName("v")[0]?.textContent ?? "";
      const inlineValue = cell.getElementsByTagName("is")[0]?.textContent ?? "";
      cells[column] = type === "s" ? sharedStrings[Number(value)] ?? "" : type === "inlineStr" ? inlineValue : value;
    });
    return cells;
  });
  return limitRows(rows);
}

async function parseOds(buffer: ArrayBuffer): Promise<SpreadsheetData> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const content = zip.file("content.xml");
  if (!content) throw new Error("This spreadsheet does not contain previewable cell data.");
  const document = parseXml(await content.async("text"));
  const table = document.getElementsByTagName("table:table")[0];
  if (!table) throw new Error("This spreadsheet does not contain previewable cell data.");

  const rows = Array.from(table.getElementsByTagName("table:table-row")).map((row) => {
    const cells: string[] = [];
    Array.from(row.children).forEach((cell) => {
      if (!cell.tagName.endsWith("table-cell") && !cell.tagName.endsWith("covered-table-cell")) return;
      const repeats = Math.min(Number(cell.getAttribute("table:number-columns-repeated")) || 1, MAX_PREVIEW_COLUMNS);
      const value = cell.textContent ?? cell.getAttribute("office:value") ?? "";
      for (let repeat = 0; repeat < repeats && cells.length < MAX_PREVIEW_COLUMNS; repeat += 1) cells.push(value);
    });
    return cells;
  });
  return limitRows(rows);
}

function parseXml(source: string): Document {
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("This spreadsheet contains invalid preview data.");
  return document;
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [[]];
  let value = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      rows.at(-1)!.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      rows.at(-1)!.push(value);
      rows.push([]);
      value = "";
    } else {
      value += character;
    }
  }
  rows.at(-1)!.push(value);
  return rows;
}

function limitRows(rows: string[][]): SpreadsheetData {
  const nonEmptyRows = rows.filter((row) => row.some((cell) => cell));
  const columnCount = Math.min(MAX_PREVIEW_COLUMNS, Math.max(1, ...nonEmptyRows.map((row) => row.length)));
  const isTruncated = nonEmptyRows.length > MAX_PREVIEW_ROWS || nonEmptyRows.some((row) => row.length > MAX_PREVIEW_COLUMNS);
  const limitedRows = nonEmptyRows.slice(0, MAX_PREVIEW_ROWS).map((row) => (
    Array.from({ length: columnCount }, (_, index) => row[index] ?? "")
  ));
  return { rows: limitedRows.length ? limitedRows : [["No cells to preview"]], isTruncated };
}

function columnIndex(reference: string | null): number | null {
  const letters = reference?.match(/[A-Z]+/i)?.[0];
  if (!letters) return null;
  return letters.toUpperCase().split("").reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function SpreadsheetGlyph() {
  return (
    <svg width="58" height="52" viewBox="0 0 58 52" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="54" height="48" rx="4" fill="var(--bg-tertiary)" stroke="var(--cat-green)" strokeWidth="1.5" />
      <path d="M2 15h54M17 15v35M35 15v35M2 32h54" stroke="var(--cat-green)" strokeWidth="1.35" />
      <path d="M8 8h7" stroke="var(--cat-green)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
