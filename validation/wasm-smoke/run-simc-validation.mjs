import { pathToFileURL } from "node:url";

const modulePath = process.argv[2];

if (!modulePath) {
  throw new Error("usage: node run-simc-validation.mjs /path/to/simc-wasm.mjs");
}

const { default: createSimc } = await import(pathToFileURL(modulePath));
const talent =
  "CcGADBD3hSPCL9Y9gz68WcKvMAAAAAAwgZwYmZmxstMPwyYbmZGzMDAAAAbgZzwYmBzYWGzMzYMDDAAAAAgBGAAAAmZZWmZmZWmZxsMzyGMz8AALmBDAgZGMzGGA";

for (const targets of [1, 3, 5]) {
  const output = [];
  const errors = [];

  await createSimc({
    arguments: [
      "druid=FeralTrainer",
      "spec=feral",
      "level=90",
      "race=tauren",
      "role=attack",
      "position=back",
      `talents=${talent}`,
      "load_default_gear=1",
      "default_actions=1",
      "set_bonus=latest_2pc=1/latest_4pc=1",
      `desired_targets=${targets}`,
      "iterations=5",
      "fixed_time=1",
      "max_time=60",
      "vary_combat_length=0",
      "fight_style=Patchwerk",
      "optimal_raid=0",
      "target_error=0",
      "threads=1",
      "seed=1210001",
    ],
    print: (line) => output.push(line),
    printErr: (line) => errors.push(line),
  });

  const report = output.join("\n");
  const dpsMatch = report.match(/\bDPS=([0-9.]+)/);
  const berserkMatch = report.match(/berserk_cat\s+:.*duration=\s*([0-9.]+)/);
  const halazziMatch = report.match(/halazzis_fury\s+:.*duration=\s*([0-9.]+)/);

  if (errors.length || !dpsMatch || berserkMatch?.[1] !== "25.0" || !halazziMatch) {
    throw new Error(
      JSON.stringify({
        targets,
        errors,
        dps: dpsMatch?.[1],
        berserkDuration: berserkMatch?.[1],
        halazzisFuryDuration: halazziMatch?.[1],
      }),
    );
  }

  console.log(
    JSON.stringify({
      targets,
      dps: Number(dpsMatch[1]),
      berserkDuration: Number(berserkMatch[1]),
      halazzisFuryDuration: Number(halazziMatch[1]),
    }),
  );
}
