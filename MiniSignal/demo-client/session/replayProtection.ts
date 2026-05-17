export class ReplayProtection {

  static processed =
    new Set<string>();

  static makeId(
    from: string,
    number: number
  ) {

    return `${from}:${number}`;
  }

  static seen(
    from: string,
    number: number
  ) {

    return this.processed.has(
      this.makeId(
        from,
        number
      )
    );
  }

  static mark(
    from: string,
    number: number
  ) {

    this.processed.add(

      this.makeId(
        from,
        number
      )
    );
  }
}