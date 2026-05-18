import crypto from "crypto";

import {
  PrivateKey,
  PublicKey
} from "@signalapp/libsignal-client";

import {
  SessionManager
} from "./session";

export class DHRatchetManager {
  static ratchetStep(
    localRatchetKey: PrivateKey,
    remoteRatchetKey: PublicKey,
    currentRootKey: Buffer
  ) {
    const dh = SessionManager.createSharedSecret(
      localRatchetKey,
      remoteRatchetKey
    );

    const output = crypto.hkdfSync(
      "sha256",
      Buffer.from(dh),
      currentRootKey,
      Buffer.from("DHRatchet"),
      64
    );

    const buffer = Buffer.from(output);

    const nextRootKey = buffer.subarray(0, 32);
    const chainKey = buffer.subarray(32, 64);

    return {
      nextRootKey,
      chainKey,
      publicKey: Buffer.from(
        localRatchetKey.getPublicKey().serialize()
      ).toString("base64")
    };
  }
}