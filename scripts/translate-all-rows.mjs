import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import translate from "translate";

const BENGALI_RE = /[\u0980-\u09FF]/;

async function convert(text) {
  const res = await translate(text, { from: "bn", to: "en" });
  return res;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function convertWithRetry(text, retries = 3) {
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await convert(text);
    } catch (err) {
      if (i === retries) throw err;
      await sleep(500 * (i + 1));
    }
  }
  return text;
}

async function run() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const inputPath =
    process.argv[2] || path.resolve(__dirname, "../../assembly_data.xlsx");
  const outputPath =
    process.argv[3] ||
    path.resolve(__dirname, "../../assembly_data_all_english.xlsx");

  const workbook = XLSX.readFile(inputPath, { cellDates: true });
  const cache = new Map();

  let translatedCells = 0;
  let failedCells = 0;
  let scannedCells = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);

    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        scannedCells += 1;
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        if (!cell || typeof cell.v !== "string") continue;
        if (!BENGALI_RE.test(cell.v)) continue;

        const source = cell.v.trim();
        if (!source) continue;

        let translated = cache.get(source);
        if (!translated) {
          try {
            translated = await convertWithRetry(source);
          } catch {
            translated = source;
            failedCells += 1;
          }
          cache.set(source, translated);
        }

        if (translated !== source) {
          sheet[addr].v = translated;
          sheet[addr].w = translated;
          translatedCells += 1;
        }

        if (cache.size % 500 === 0 && cache.size > 0) {
          console.log(
            `Progress: unique=${cache.size}, translatedCells=${translatedCells}, scanned=${scannedCells}`
          );
        }
      }
    }
  }

  XLSX.writeFile(workbook, outputPath);

  console.log(`Input : ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Translated cells: ${translatedCells}`);
  console.log(`Unique source strings: ${cache.size}`);
  console.log(`Failed unique strings: ${failedCells}`);
}

run().catch((err) => {
  console.error("Translation script failed:", err?.message || err);
  process.exit(1);
});
