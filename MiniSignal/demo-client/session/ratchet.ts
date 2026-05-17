import crypto from "crypto";

export class RatchetManager {

  static kdfChain(
    chainKey: Buffer
  ) {

    const nextChainKey =
      crypto
        .createHmac(
          "sha256",
          chainKey
        )
        .update("chain")
        .digest();

    const messageKey =
      crypto
        .createHmac(
          "sha256",
          chainKey
        )
        .update("message")
        .digest();

    return {

      nextChainKey,

      messageKey
    };
  }
}