export interface WasteLogListRequestToken {
    requestId: number;
    labId: string | null;
}

export function canCommitWasteLogListRequest(
    token: WasteLogListRequestToken,
    currentRequestId: number,
    currentLabId: string | null,
): boolean {
    return token.requestId === currentRequestId && token.labId === currentLabId;
}
