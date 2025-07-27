import { consumer } from "./sub";

declare const self: Worker;

self.onmessage = async (event) => {
  await consumer();
};
