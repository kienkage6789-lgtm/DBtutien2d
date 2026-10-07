const url = "wss://game.tutien2d.online/";
const token = process.env.TUTIEN_TEST_TOKEN;
if (!token) throw new Error("Set TUTIEN_TEST_TOKEN in the environment before running this test.");

const payload = {
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

console.log("Connecting to", url, "...");
const ws = new WebSocket(url);

ws.onopen = () => {
  console.log("[OPEN] Connected successfully!");
  console.log("[SEND] Sending hello payload (token redacted)");
  ws.send(JSON.stringify(payload));
};

ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    console.log("[MESSAGE]", JSON.stringify(safePacket(data)));
    if (data.op === "ping") ws.send(JSON.stringify({ op: "pong" }));
  } catch {
    console.log("[MESSAGE] malformed packet (raw content redacted)");
  }
};

ws.onerror = (err) => console.error("[ERROR]", err?.message || "websocket error");
ws.onclose = (event) => {
  console.log(`[CLOSE] Code: ${event.code}, Reason: ${event.reason}`);
  process.exit(0);
};

setTimeout(() => {
  console.log("[TIMEOUT] Closing connection after 15s...");
  ws.close();
}, 15000);
