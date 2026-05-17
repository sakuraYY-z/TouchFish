import fs from "fs";

export const SESSION_VERSION = 1;

export class SessionStore {

  static getPath(
    userId: string,
    targetId: string
  ) {

    return `./storage/session_${userId}_${targetId}.json`;
  }

  static save(

    userId: string,

    targetId: string,

    data: any
  ) {

    const sessionData = {
      version: SESSION_VERSION,
      ...data
    };

    fs.writeFileSync(

      this.getPath(
        userId,
        targetId
      ),

      JSON.stringify(
        sessionData,
        null,
        2
      )
    );
  }

  static load(
    userId: string,
    targetId: string
  ) {

    const path =
      this.getPath(
        userId,
        targetId
      );

    if (
      !fs.existsSync(path)
    ) {
      return null;
    }

     return JSON.parse(
      fs.readFileSync(
        path,
        "utf8"
      )
    );
  }
}