import { askAgent } from "../src/agent/loop.js";
import { recordSeen } from "../src/services/device-health.js";
import { saveLatest } from "../src/services/telemetry-store.js";
import type { AssistantTurn, ChatFn, ChatMessage } from "../src/types/index.js";

// Seed the in-memory store so list_devices has something to return.
const now = new Date();
recordSeen("esp32-01", now);
saveLatest({ deviceId: "esp32-01", temperature: 24.1, humidity: 60.4, receivedAt: now });

function scripted(turns: AssistantTurn[]): ChatFn {
  let i = 0;
  return async (messages: ChatMessage[]) => {
    const turn = turns[Math.min(i, turns.length - 1)];
    i += 1;
    console.log(`   [model turn ${i}] history length ${messages.length}`);
    return turn ?? { text: "no more turns", toolCalls: [] };
  };
}

console.log("\n1. Answers immediately, no tools");
console.log(await askAgent(scripted([{ text: "It is 24.1 degrees.", toolCalls: [] }]), "how hot?"));

console.log("\n2. Calls list_devices, then answers");
console.log(
  await askAgent(
    scripted([
      { text: null, toolCalls: [{ id: "c1", name: "list_devices", argumentsJson: "{}" }] },
      { text: "One device, esp32-01, online.", toolCalls: [] },
    ]),
    "what devices are there?"
  )
);

console.log("\n3. Asks for a tool that does not exist");
console.log(
  await askAgent(
    scripted([
      { text: null, toolCalls: [{ id: "c1", name: "delete_everything", argumentsJson: "{}" }] },
      { text: "I could not do that.", toolCalls: [] },
    ]),
    "delete it all"
  )
);

console.log("\n4. Sends malformed JSON arguments");
console.log(
  await askAgent(
    scripted([
      { text: null, toolCalls: [{ id: "c1", name: "get_readings", argumentsJson: "{not json" }] },
      { text: "My arguments were malformed.", toolCalls: [] },
    ]),
    "readings please"
  )
);

console.log("\n5. Never stops calling tools (cap is 3 here)");
const runaway = await askAgent(
  scripted([{ text: null, toolCalls: [{ id: "c1", name: "list_devices", argumentsJson: "{}" }] }]),
  "loop forever",
  3
);
console.log({ truncated: runaway.truncated, steps: runaway.steps.length, answer: runaway.answer });