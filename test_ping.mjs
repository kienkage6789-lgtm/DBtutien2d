const url = "wss://game.tutien2d.online/";
const token = process.env.TUTIEN_TEST_TOKEN;
if (!token) throw new Error("Set TUTIEN_TEST_TOKEN in the environment before running this test.");

const helloPayload = {
  op: "hello",
  features: { formation: 1 },
  name: process.env.TUTIEN_TEST_NAME || "",
  proto: 10,
  snap: 2,
  token,
};

const safePacket = (data) => ({
  op: typeof data?.op === "string" ? data.op : "unknown",
  keys: data && typeof data === "object" ? Object.keys(data).sort() : [],
});

const ws = new WebSocket(url);

ws.onopen = () => {
  console.log("[OPEN] Connected!");
  ws.send(JSON.stringify(helloPayload));
  console.log("[SEND] Sent hello (token redacted)");

  setTimeout(() => {
    const pingMsg = { op: "ping", t: Date.now() };
    console.log("[SEND PING]", JSON.stringify(pingMsg));
    ws.send(JSON.stringify(pingMsg));
  }, 1000);
};

ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    if (data.op === "snap2" || data.op === "hon") return;
    console.log("[RECV]", JSON.stringify(safePacket(data)));
  } catch {
    console.log("[RECV] malformed packet (raw content redacted)");
  }
};

ws.onerror = (err) => console.error("[ERROR]", err?.message || "websocket error");
ws.onclose = (event) => {
  console.log(`[CLOSE] Code: ${event.code}, Reason: ${event.reason}`);
  process.exit(0);
};

setTimeout(() => {
  console.log("[DONE] Finished ping test.");
  ws.close();
}, 4000);
