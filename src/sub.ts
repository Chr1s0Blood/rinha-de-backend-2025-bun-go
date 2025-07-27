import { Type } from "@sinclair/typebox";
import type { TPaymentData } from "./types";
import { updateProcessedAtAndProcessor } from "./db";
import createAccelerator from "json-accelerator";
import { Agent, request } from "undici";
import { connect, type NatsConnection } from "@nats-io/transport-node";
import { publisher } from "./pub";
import { redis } from "bun";

const httpAgent = new Agent({
  pipelining: 3,
  connections: 10,
});

const processorsEndpoint = {
  default: process.env.PAYMENT_PROCESSOR_URL_DEFAULT!,
  fallback: process.env.PAYMENT_PROCESSOR_URL_FALLBACK!,
};

const paymentObject = Type.Object({
  amount: Type.Number(),
  correlationId: Type.String(),
  requestedAt: Type.String(),
});

const encode = createAccelerator(paymentObject);

const MAX_CONCURRENT = 5;

let natsConnection: NatsConnection;
const processorsCache = new Map<string, string>();

async function initializeNats() {
  natsConnection = await connect({
    servers: process.env.NATS_URL!,
  });
}

export async function consumer() {
  await initializeNats();

  await redis.connect();

  let activeProcessing = 0;

  const subscription = natsConnection.subscribe("payment-requests", {
    queue: "payment-processors",
  });

  for await (const msg of subscription) {
    if (activeProcessing >= MAX_CONCURRENT) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      continue;
    }

    activeProcessing++;

    processMessageAsync(msg.string()).finally(() => {
      activeProcessing--;
    });
  }
}

async function processMessageAsync(messageData: string) {
  try {
    await handlePaymentToProcessor(messageData);
  } catch (error) {
    console.error("Erro processar mensagem:", error);
  }
}

async function tryProcessorWithTiming(
  processorType: "default" | "fallback",
  dataEncoded: string,
  correlationId: string
): Promise<{ success: boolean; responseTime: number }> {
  const startTime = Date.now();

  try {
    const request =
      processorType === "default"
        ? await tryRequestDefaultProcessor(dataEncoded)
        : await tryRequestFallbackProcessor(dataEncoded);

    const responseTime = Date.now() - startTime;

    if (request?.statusCode === 200) {
      return { success: true, responseTime };
    }

    return { success: false, responseTime };
  } catch (error) {
    return { success: false, responseTime: Date.now() - startTime };
  }
}

async function updateBestProcessor(
  currentBest: string,
  usedProcessor: string,
  responseTime: number
) {
  if (usedProcessor !== currentBest) {
    processorsCache.set("bestProcessor", usedProcessor);
    natsConnection.publish(
      "processor-updates",
      JSON.stringify({
        key: "bestProcessor",
        value: usedProcessor,
      })
    );
  } else if (usedProcessor === "fallback" && responseTime > 300) {
    processorsCache.set("bestProcessor", "default");
    natsConnection.publish(
      "processor-updates",
      JSON.stringify({
        key: "bestProcessor",
        value: "default",
      })
    );
  }
}

async function handlePaymentToProcessor(messageData: string) {
  const data: TPaymentData = JSON.parse(messageData);
  const nowISO = new Date().toISOString();

  let bestProcessor = processorsCache.get("bestProcessor") || "default";
  const dataEncoded = encode({
    amount: data.amount,
    correlationId: data.correlationId,
    requestedAt: nowISO,
  });

  let processorRequested: string | null = null;
  let responseTime = 0;

  const primaryResult = await tryProcessorWithTiming(
    bestProcessor as "default" | "fallback",
    dataEncoded,
    data.correlationId
  );

  if (primaryResult.success) {
    processorRequested = bestProcessor;
    responseTime = primaryResult.responseTime;
  } else {
    const fallbackProcessorType =
      bestProcessor === "default" ? "fallback" : "default";
    const fallbackResult = await tryProcessorWithTiming(
      fallbackProcessorType,
      dataEncoded,
      data.correlationId
    );

    if (fallbackResult.success) {
      processorRequested = fallbackProcessorType;
      responseTime = fallbackResult.responseTime;
    }
  }

  if (!processorRequested) {
    console.error(
      `Processors failed for ${data.correlationId}, requeue...`
    );
    await publisher(data);
    return;
  }

  await Promise.all([
    updateBestProcessor(bestProcessor, processorRequested, responseTime),
    updateProcessedAtAndProcessor(
      data.correlationId,
      nowISO,
      processorRequested
    ),
  ]);
}

function tryRequestDefaultProcessor(data: string) {
  const urlDefault = `${processorsEndpoint.default}/payments`;
  return request(urlDefault, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: data,
    dispatcher: httpAgent,
  });
}

function tryRequestFallbackProcessor(data: string) {
  const urlFallback = `${processorsEndpoint.fallback}/payments`;
  return request(urlFallback, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: data,
    dispatcher: httpAgent,
  });
}
