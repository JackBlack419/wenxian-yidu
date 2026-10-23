import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
const out=path.resolve(".qa/fixtures/中文目录 with spaces");
fs.mkdirSync(out,{recursive:true});
const body=[
  "This study evaluates the accuracy of machine translation in scientific reading. The experiment compares three translation methods on controlled documents.",
  "The results show that paragraph alignment improves reading efficiency. Original figures, equations, and numeric values must remain unchanged during translation.",
  "The proposed method uses a shared cache. Repeated requests for the same paragraph should reuse an existing translation and avoid additional network calls.",
];
async function doc(name,columns=1,pages=1){
 const pdf=await PDFDocument.create(); const regular=await pdf.embedFont(StandardFonts.TimesRoman);const bold=await pdf.embedFont(StandardFonts.TimesRomanBold);
 for(let p=0;p<pages;p++){
  const page=pdf.addPage([595,842]);const pad=44;const gap=24;const width=(595-2*pad-(columns-1)*gap)/columns;
  page.drawText(`Translation Validation Paper - ${name}`,{x:pad,y:792,size:16,font:bold});
  page.drawText(`Synthetic fixture. No real user document. Page ${p+1}.`,{x:pad,y:767,size:10,font:regular});
  for(let c=0;c<columns;c++){
   let y=730; const x=pad+c*(width+gap);
   page.drawText(c===0?"1. Introduction":"2. Results",{x,y,size:13,font:bold});y-=25;
   for(let j=0;j<4;j++){
    const words=body[(j+p+c)%body.length].split(" ");let line="";
    for(const word of words){const candidate=line?line+" "+word:word;if(regular.widthOfTextAtSize(candidate,11)>width){page.drawText(line,{x,y,size:11,font:regular});y-=15;line=word;}else line=candidate;}
    if(line){page.drawText(line,{x,y,size:11,font:regular});y-=15;}y-=15;
   }
   page.drawText("Equation 1: E = m c^2",{x,y,size:12,font:regular});y-=30;
   page.drawText("Table 1. Accuracy by method",{x,y,size:10,font:bold});y-=18;
   for(const [index,row] of ["Method        Accuracy","Baseline       0.82","Aligned        0.94"].entries()){page.drawText(row,{x:x+5,y:y-index*18,size:10,font:regular});page.drawLine({start:{x,y:y-index*18-5},end:{x:x+width,y:y-index*18-5},thickness:.4});}
   y-=80;page.drawRectangle({x:x+8,y:y-45,width:width-16,height:45,color:rgb(.88,.92,.98)});
   page.drawText("Figure 1. Reading progress over time.",{x,y:y-62,size:9,font:regular});
  }
  page.drawText(String(p+1),{x:290,y:25,size:10,font:regular});
 }
 await fs.promises.writeFile(path.join(out,name+".pdf"),await pdf.save());
}
await doc("single-column",1,2);await doc("double-column",2,2);await doc("long-document",2,12);
// A paragraph genuinely continues onto the next page, without a new heading.
const cross=await PDFDocument.create();
const crossFont=await cross.embedFont(StandardFonts.TimesRoman);
const crossOne=cross.addPage([595,842]);
crossOne.drawText("3. Cross-page paragraph",{x:44,y:780,size:16,font:crossFont});
crossOne.drawText("The experiment begins with a controlled evaluation of translation quality",{x:44,y:72,size:11,font:crossFont});
crossOne.drawText("and continues across the page boundary, preserving the connection",{x:44,y:57,size:11,font:crossFont});
const crossTwo=cross.addPage([595,842]);
crossTwo.drawText("between the original paragraph and its Chinese translation. This sentence",{x:44,y:780,size:11,font:crossFont});
crossTwo.drawText("finishes the same paragraph on the following page.",{x:44,y:765,size:11,font:crossFont});
await fs.promises.writeFile(path.join(out,"cross-page.pdf"),await cross.save());
const scan=await PDFDocument.create();const p=scan.addPage([595,842]);p.drawRectangle({x:44,y:500,width:500,height:250,color:rgb(.92,.92,.92)});p.drawLine({start:{x:80,y:600},end:{x:510,y:700},thickness:3});
await fs.promises.writeFile(path.join(out,"scan-without-text.pdf"),await scan.save());
fs.writeFileSync(path.join(out,"manifest.json"),JSON.stringify({synthetic:true,description:"No personal data or real research documents. Formula/table/caption plus single/double columns, true cross-page paragraph, and long document; scan negative has no text layer.",files:fs.readdirSync(out).filter(x=>x.endsWith('.pdf'))},null,2));
console.log(out);
