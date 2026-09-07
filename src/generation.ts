// pattern: Functional Core

export function canStartDecode(
  currentGeneration: number,
  activeGeneration: number | null,
  requestedGeneration: number,
): boolean {
  return requestedGeneration >= currentGeneration && activeGeneration !== requestedGeneration;
}

export function isCurrentGeneration(messageGeneration: number, currentGeneration: number): boolean {
  return messageGeneration === currentGeneration;
}

export function shouldRecreateWorkerForGeneration(previousGeneration: number | null, nextGeneration: number): boolean {
  return previousGeneration !== null && nextGeneration <= previousGeneration;
}
