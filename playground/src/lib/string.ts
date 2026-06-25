import {
  split,
  noCase,
  camelCase,
  pascalCase,
  pascalSnakeCase,
  capitalCase,
  constantCase,
  dotCase,
  kebabCase,
  pathCase,
  sentenceCase,
  snakeCase,
  trainCase,
} from "change-case";

export class Str {
  static convert(value: unknown, fallback = ""): string {
    return value == null || value === "" ? fallback : String(value);
  }

  static words(value: unknown): string[] {
    return split(Str.convert(value));
  }

  static lower(value: unknown): string {
    return noCase(Str.convert(value));
  }

  static camel(value: unknown): string {
    return camelCase(Str.convert(value));
  }

  static pascal(value: unknown): string {
    return pascalCase(Str.convert(value));
  }

  static pascalSnake(value: unknown): string {
    return pascalSnakeCase(Str.convert(value));
  }

  static title(value: unknown): string {
    return capitalCase(Str.convert(value));
  }

  static upperSnake(value: unknown): string {
    return constantCase(Str.convert(value));
  }

  static dot(value: unknown): string {
    return dotCase(Str.convert(value));
  }

  static kebab(value: unknown): string {
    return kebabCase(Str.convert(value));
  }

  static path(value: unknown): string {
    return pathCase(Str.convert(value));
  }

  static sentence(value: unknown): string {
    return sentenceCase(Str.convert(value));
  }

  static snake(value: unknown): string {
    return snakeCase(Str.convert(value));
  }

  static header(value: unknown): string {
    return trainCase(Str.convert(value));
  }

  static initials(value: unknown, fallback = "", maxLength?: number): string {
    const matches = Str.convert(value).match(/\b\w/g);
    if (!matches?.length) return fallback;
    return (maxLength ? matches.slice(0, maxLength) : matches)
      .join("")
      .toUpperCase();
  }

  static join(delimiter: string, values: unknown[]): string {
    return values.filter((v) => v != null && v !== "").join(delimiter);
  }
}
