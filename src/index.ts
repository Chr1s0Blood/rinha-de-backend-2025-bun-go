import { consumer } from "./sub";
import type { IPaymentDataRaw, ISummaryRaw } from "./types";
import {
  createPaymentsTable,
  getSummary,
  insertPaymentData,
  purgePayments,
} from "./db";
import { publisher } from "./pub";
import { redis } from "bun";

await createPaymentsTable();

const PORT = parseInt(process.env.PORT!);

async function processPaymentRequest(req: Request) {

  const nowISO = new Date().toISOString();

  const data = await req.json() as IPaymentDataRaw;

  await insertPaymentData(data.correlationId, data.amount, nowISO);

  await publisher({
    amount: data.amount,
    correlationId: data.correlationId,
    requestedAt: nowISO,
  });

  return new Response(null, {
    status: 201,
  });
}

async function processSummaryRequest(req: Request) {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const timeStart = Date.now();
    const summary = (await getSummary(from!, to!)) as ISummaryRaw[];

    const timeEnd = Date.now();
    const timeLevado = timeEnd - timeStart;

    console.log(`Summary request processed in ${timeLevado}ms`);
    const grouped = {
      default: { totalRequests: 0, totalAmount: 0 },
      fallback: { totalRequests: 0, totalAmount: 0 },
    };

    for (const item of summary) {
      const processor = item.processor as "default" | "fallback";
      if (processor === "default" || processor === "fallback") {
        grouped[processor].totalRequests = +item.total_requests;
        grouped[processor].totalAmount = +item.total_amount;
      }
    }


    return Response.json(grouped);
  } catch (error) {
    console.error("Error processing summary request:", error);
    return Response.json(
      { error: "Failed to process summary request" },
      { status: 500 }
    );
  }
}

Bun.serve({
  port: PORT,
  development: false,
  routes: {
    "/payments": {
      POST: processPaymentRequest,
    },
    "/payments-summary": {
      GET: processSummaryRequest,
    },
    "/purge-payments": {
      POST: async () => {
        await purgePayments();
        return Response.json({
          message: "Payments purged successfully",
        });
      },
    },
  },
});

await redis.send("FLUSHALL", []);

const WORKERS = 1;

for (let i = 0; i < WORKERS; i++) {
  const worker = new Worker(new URL("./worker-sub.ts", import.meta.url), {
    type: "module",
  });

  worker.postMessage('start')
}
