export interface LabRequestToken {
  generation: number;
  labId: string | null;
}

export function canCommitLabRequest(
  token: LabRequestToken,
  currentGeneration: number,
  currentLabId: string | null,
): boolean {
  return token.generation === currentGeneration && token.labId === currentLabId;
}
