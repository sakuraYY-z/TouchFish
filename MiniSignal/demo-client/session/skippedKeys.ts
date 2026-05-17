export class SkippedKeyStore {

  static skipped =
    new Map<
      number,
      string
    >();

  static save(
    number: number,
    key: string
  ) {

    this.skipped.set(
      number,
      key
    );
  }

  static get(
    number: number
  ) {

    return this.skipped.get(
      number
    );
  }

  static has(
    number: number
  ) {

    return this.skipped.has(
      number
    );
  }
}