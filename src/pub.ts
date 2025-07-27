import { Type } from "@sinclair/typebox";
import createAccelerator from "json-accelerator";
import type { TPaymentData } from "./types";

import { connect, type NatsConnection } from '@nats-io/transport-node';

const paymentObject = Type.Object({
  amount: Type.Number(),
  correlationId: Type.String(),
  requestedAt: Type.String(),
});


let natsConnection: NatsConnection;

async function initializeNats() {
  natsConnection = await connect({
    servers: process.env.NATS_URL!
  });
}

const encode = createAccelerator(paymentObject);

export async function publisher(data: TPaymentData) {
  if (!natsConnection) {
    await initializeNats();
  }
  const encodedData = encode(data);
  return natsConnection.publish("payment-requests", encodedData);
}