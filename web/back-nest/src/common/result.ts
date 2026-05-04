export class Result<T = void> {
  private constructor(
    public readonly isSuccess: boolean,
    public readonly value?: T,
    public readonly error?: string,
  ) {}

  get isFailure(): boolean {
    return !this.isSuccess;
  }

  static ok<T>(value?: T): Result<T> {
    return new Result(true, value);
  }

  static fail<T>(error: string): Result<T> {
    return new Result(false, undefined as unknown as T, error);
  }
}
