import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

// A long synthetic PDF whose paragraphs are UNIQUE (so the paragraph cache can
// never serve them): used to observe a genuinely long-running translation in
// the reader toolbar (progress label + cancel → resume).
const out = path.resolve(".qa/fixtures/中文目录 with spaces");
fs.mkdirSync(out, { recursive: true });

const subjects = [
  "The calibration pipeline reconciles sensor drift across instruments",
  "A federated scheduler coordinates batch jobs between research clusters",
  "Chemical assays show a monotonic response under controlled humidity",
  "The annotation protocol reduces disagreement between independent raters",
  "Spectral analysis reveals a narrow absorption band near the threshold",
  "The survey instrument captures longitudinal reading behaviour reliably",
  "Cryogenic measurements confirm the predicted phase transition",
  "A sparse matrix solver accelerates the simulation by an order of magnitude",
];
const predicates = [
  "and the residual error remains below the reported tolerance",
  "while keeping the throughput stable for repeated runs",
  "even when the input distribution shifts substantially",
  "so the replication study can reproduce the published values",
  "provided the ambient temperature is recorded alongside the data",
  "which the authors attribute to the revised sampling strategy",
];

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.TimesRoman);
const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
let counter = 0;
for (let p = 0; p < 8; p++) {
  const page = pdf.addPage([595, 842]);
  page.drawText(`Unique Paragraph Corpus (section ${p + 1})`, {
    x: 44, y: 792, size: 15, font: bold,
  });
  let y = 750;
  for (let i = 0; i < 5; i++) {
    counter++;
    const text =
      `Observation ${counter}: ${subjects[(counter + p) % subjects.length]} ` +
      `${predicates[(counter + i) % predicates.length]}.`;
    // wrap at ~95 chars
    let line = "";
    for (const word of text.split(" ")) {
      const cand = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(cand, 11) > 505) {
        page.drawText(line, { x: 44, y, size: 11, font });
        y -= 15;
        line = word;
      } else line = cand;
    }
    if (line) {
      page.drawText(line, { x: 44, y, size: 11, font });
      y -= 15;
    }
    y -= 22;
  }
  page.drawText(String(p + 1), { x: 290, y: 25, size: 10, font });
}
const file = path.join(out, "unique-paragraphs.pdf");
await fs.promises.writeFile(file, await pdf.save());
console.log(file, counter, "paragraphs");
