import createTrainer from "./trainer-smoke.mjs";

const trainer = await createTrainer();
const talent =
  "CcGADBD3hSPCL9Y9gz68WcKvMAAAAAAwgZwYmZmxstMPwyYbmZGzMDAAAAbgZzwYmBzYWGzMzYMDDAAAAAgBGAAAAmZZWmZmZWmZxsMzyGMz8AALmBDAgZGMzGGA";
const talentPtr = trainer.stringToNewUTF8(talent);

try {
  const resultPtr = trainer._trainer_smoke(talentPtr, 5);
  const result = JSON.parse(trainer.UTF8ToString(resultPtr));

  if (!result.accepted || result.targets !== 5 || result.talentLength !== talent.length) {
    throw new Error(`unexpected WASM response: ${JSON.stringify(result)}`);
  }

  console.log(JSON.stringify(result));
} finally {
  trainer._free(talentPtr);
}
