import { NextRequest, NextResponse } from "next/server";
import { inflateRawSync } from "node:zlib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportedRow = Record<string, string>;

type ParsedTable = {
  headers: string[];
  rows: ImportedRow[];
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;

function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function makeUniqueHeaders(rawHeaders: string[]): string[] {
  const used = new Map<string, number>();

  return rawHeaders.map((header, index) => {
    const base = cleanCell(header) || `Column ${index + 1}`;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function rowsToObjects(rawRows: string[][]): ParsedTable {
  const nonEmptyRows = rawRows.filter((row) => row.some((cell) => cleanCell(cell)));
  if (nonEmptyRows.length === 0) {
    throw new Error("File không có dữ liệu.");
  }

  const headers = makeUniqueHeaders(nonEmptyRows[0]);
  const rows = nonEmptyRows.slice(1, MAX_ROWS + 1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, cleanCell(row[index])])) as ImportedRow,
  );

  return {
    headers,
    rows,
  };
}

function countDelimiter(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && nextChar === '"') {
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }

  return count;
}

function detectDelimiter(text: string): string {
  const sampleLine = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .find((line) => line.trim()) ?? "";
  const candidates = [";", ",", "\t"];

  return candidates.reduce((best, candidate) =>
    countDelimiter(sampleLine, candidate) > countDelimiter(sampleLine, best) ? candidate : best,
  );
}

function parseDelimitedText(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const normalizedText = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < normalizedText.length; index += 1) {
    const char = normalizedText[index];
    const nextChar = normalizedText[index + 1];

    if (char === '"' && nextChar === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);

  return rows;
}

function parseCsv(buffer: Buffer): ParsedTable {
  const text = buffer.toString("utf-8");
  return rowsToObjects(parseDelimitedText(text));
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function getXmlAttribute(tag: string, attribute: string): string {
  const pattern = new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return decodeXml(tag.match(pattern)?.[2] ?? "");
}

function normalizeZipPath(path: string): string {
  const parts: string[] = [];

  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join("/");
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  const minEocdOffset = Math.max(0, buffer.length - 65557);
  let eocdOffset = -1;

  for (let offset = buffer.length - 22; offset >= minEocdOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("Không đọc được cấu trúc file .xlsx.");
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(centralOffset) !== centralSignature) {
      throw new Error("File .xlsx có central directory không hợp lệ.");
    }

    const compressionMethod = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const fileName = buffer.toString("utf-8", centralOffset + 46, centralOffset + 46 + fileNameLength);

    if (buffer.readUInt32LE(localOffset) !== localSignature) {
      throw new Error("File .xlsx có local header không hợp lệ.");
    }

    const localFileNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localFileNameLength + localExtraLength;
    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

    if (compressionMethod === 0) {
      entries.set(normalizeZipPath(fileName), Buffer.from(compressedData));
    } else if (compressionMethod === 8) {
      entries.set(normalizeZipPath(fileName), inflateRawSync(compressedData));
    }

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function extractXmlText(xml: string): string {
  const parts = Array.from(xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), (match) => decodeXml(match[1]));
  return parts.join("");
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), (match) => extractXmlText(match[1]));
}

function parseWorkbookRelationships(xml: string): Map<string, string> {
  const relationships = new Map<string, string>();

  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attributes = match[1];
    const id = getXmlAttribute(attributes, "Id");
    const target = getXmlAttribute(attributes, "Target");
    if (id && target) relationships.set(id, target);
  }

  return relationships;
}

function columnIndexFromRef(cellRef: string): number {
  const letters = cellRef.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  let index = 0;

  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }

  return Math.max(0, index - 1);
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];

    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2];
      const ref = getXmlAttribute(attributes, "r");
      const type = getXmlAttribute(attributes, "t");
      const columnIndex = ref ? columnIndexFromRef(ref) : row.length;
      const valueMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      let value = "";

      if (type === "inlineStr") {
        value = extractXmlText(body);
      } else if (valueMatch) {
        const rawValue = decodeXml(valueMatch[1]);
        if (type === "s") {
          value = sharedStrings[Number(rawValue)] ?? "";
        } else if (type === "b") {
          value = rawValue === "1" ? "TRUE" : "FALSE";
        } else {
          value = rawValue;
        }
      }

      row[columnIndex] = value;
    }

    rows.push(row);
  }

  return rows;
}

function parseXlsx(buffer: Buffer): ParsedTable {
  const entries = readZipEntries(buffer);
  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf-8");
  const relsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf-8");

  if (!workbookXml || !relsXml) {
    throw new Error("File .xlsx thiếu workbook metadata.");
  }

  const firstSheetTag = workbookXml.match(/<sheet\b[^>]*>/)?.[0] ?? "";
  const relationId = getXmlAttribute(firstSheetTag, "r:id");
  const target = parseWorkbookRelationships(relsXml).get(relationId);

  if (!target) {
    throw new Error("Không tìm thấy sheet đầu tiên trong file .xlsx.");
  }

  const sheetPath = normalizeZipPath(target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  const worksheetXml = entries.get(sheetPath)?.toString("utf-8");

  if (!worksheetXml) {
    throw new Error("Không đọc được worksheet đầu tiên trong file .xlsx.");
  }

  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf-8"));
  return rowsToObjects(parseWorksheetRows(worksheetXml, sharedStrings));
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "Vui lòng chọn file CSV hoặc Excel." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_FILE_BYTES) {
      return NextResponse.json({ ok: false, message: "File quá lớn. Giới hạn hiện tại là 10MB." }, { status: 400 });
    }

    const fileName = file.name || "data";
    const lowerName = fileName.toLowerCase();
    let parsed: ParsedTable;
    if (lowerName.endsWith(".xlsx") || file.type.includes("spreadsheetml")) {
      parsed = parseXlsx(buffer);
    } else if (lowerName.endsWith(".xls")) {
      throw new Error("File .xls đời cũ chưa được hỗ trợ. Hãy lưu lại thành .xlsx hoặc CSV.");
    } else {
      parsed = parseCsv(buffer);
    }

    return NextResponse.json({
      ok: true,
      data: {
        fileName,
        headers: parsed.headers,
        rows: parsed.rows,
        rowCount: parsed.rows.length,
        previewRows: parsed.rows.slice(0, 3),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không đọc được file dữ liệu.";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
