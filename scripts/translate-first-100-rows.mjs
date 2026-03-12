import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import translate from "translate";

const BENGALI_RE = /[\u0980-\u09FF]/;

async function convert(text) {
  const res = await translate(text, { from: "bn", to: "en" });
  return res;
}

async function run() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const inputPath =
    process.argv[2] || path.resolve(__dirname, "../../assembly_data.xlsx");
  const outputPath =
    process.argv[3] ||
    path.resolve(__dirname, "../../assembly_data_first100_english.xlsx");

  const workbook = XLSX.readFile(inputPath, { cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const lastRow = Math.min(range.e.r, 99); // 0-based, so this is first 100 rows
  const cache = new Map();

  let changed = 0;
  for (let r = 0; r <= lastRow; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell || typeof cell.v !== "string") continue;
      if (!BENGALI_RE.test(cell.v)) continue;

      const source = cell.v.trim();
      if (!source) continue;

      let translated = cache.get(source);
      if (!translated) {
        translated = await convert(source);
        cache.set(source, translated);
      }

      sheet[addr].v = translated;
      sheet[addr].w = translated;
      changed += 1;
    }
  }

  XLSX.writeFile(workbook, outputPath);

  console.log(`Input : ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Sheet : ${firstSheetName}`);
  console.log(`Rows translated scope: 1 to ${lastRow + 1}`);
  console.log(`Changed cells: ${changed}`);
  console.log(`Unique source strings translated: ${cache.size}`);
}

run().catch((err) => {
  console.error("Translation script failed:", err?.message || err);
  process.exit(1);
});
