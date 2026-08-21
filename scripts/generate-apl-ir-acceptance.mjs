import { mkdir, writeFile } from "node:fs/promises";

import { buildAplIrAcceptance } from "./lib/apl-ir-acceptance.mjs";

const outputDirectory = new URL("../validation/apl/", import.meta.url);
const outputFile = new URL("g3-apl-ir-acceptance.json", outputDirectory);
const acceptance = await buildAplIrAcceptance();

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(acceptance, null, 2)}\n`, "utf8");
console.log(outputFile.pathname);
