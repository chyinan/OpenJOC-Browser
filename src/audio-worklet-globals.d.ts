declare class AudioWorkletProcessor {
  public readonly port: MessagePort;
  public constructor(options?: AudioWorkletNodeOptions);
}

declare function registerProcessor(
  name: string,
  processorConstructor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

declare const sampleRate: number;
