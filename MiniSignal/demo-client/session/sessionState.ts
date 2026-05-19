import crypto from "crypto";

export interface MiniSessionState {
  version: 3;

  localUserId: string;
  localDeviceId: string;
  remoteUserId: string;
  remoteDeviceId: string;

  rootKey: string;

  sendChainKey: string;
  recvChainKey: string;

  sendCounter: number;
  recvCounter: number;

  localRatchetPrivateKey: string;
  localRatchetPublicKey: string;

  remoteRatchetPublicKey: string | null;

  previousSendCounter: number;

  skippedMessageKeys: Record<string, string>;
}

export function pairRole(
  localUserId: string,
  localDeviceId: string,
  remoteUserId: string,
  remoteDeviceId: string
): "low" | "high" {
  const local = `${localUserId}:${localDeviceId}`;
  const remote = `${remoteUserId}:${remoteDeviceId}`;

  return local < remote ? "low" : "high";
}

export function deriveDirectionalChains(
  rootKey: Buffer,
  localUserId: string,
  localDeviceId: string,
  remoteUserId: string,
  remoteDeviceId: string
) {
  const lowToHigh = crypto
    .createHmac("sha256", rootKey)
    .update("MiniSignal low->high")
    .digest();

  const highToLow = crypto
    .createHmac("sha256", rootKey)
    .update("MiniSignal high->low")
    .digest();

  const role = pairRole(localUserId, localDeviceId, remoteUserId, remoteDeviceId);

  return {
    sendChainKey: role === "low" ? lowToHigh : highToLow,
    recvChainKey: role === "low" ? highToLow : lowToHigh,
  };
}

export function nextMessageKey(chainKey: Buffer) {
  const nextChainKey = crypto
    .createHmac("sha256", chainKey)
    .update("chain")
    .digest();

  const messageKey = crypto
    .createHmac("sha256", chainKey)
    .update("message")
    .digest();

  return {
    nextChainKey,
    messageKey,
  };
}