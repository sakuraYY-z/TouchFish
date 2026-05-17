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

    localRatchetKey:
      PrivateKey,

    remoteRatchetKey:
      PublicKey,

    currentRootKey:
      Buffer
  ) {

    const dh =
      SessionManager
        .createSharedSecret(
          localRatchetKey,
          remoteRatchetKey
        );

    const nextRootKey =
      crypto.hkdfSync(
        "sha256",

        Buffer.from(dh),

        currentRootKey,

        Buffer.from(
          "DHRatchet"
        ),

        32
      );

    return {

      nextRootKey,

      publicKey:
        Buffer
          .from(
            localRatchetKey
              .getPublicKey()
              .serialize()
          )
          .toString("base64")
    };
  }
}