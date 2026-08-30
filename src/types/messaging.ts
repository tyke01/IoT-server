/**
 * How the rest of the program asks for something to be published, without
 * knowing that MQTT exists. index.ts supplies the real implementation.
 */
export type PublishFn = (topic: string, payload: string) => Promise<void>;