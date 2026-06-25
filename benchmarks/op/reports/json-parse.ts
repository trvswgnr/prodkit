import { readFile } from "node:fs/promises";
import { isRecordLike } from "@prodkit/shared/runtime";

export type JsonRecord = Record<PropertyKey, unknown>;

export class BenchmarkParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkParseError";
  }
}

export function parseError(location: string, message: string): never {
  throw new BenchmarkParseError(`${location}: ${message}`);
}

export function parseRecord(value: unknown, location: string): JsonRecord {
  if (!isRecordLike(value)) parseError(location, "expected object");
  return value;
}

export function parseString(value: unknown, location: string): string {
  if (typeof value !== "string" || value.length === 0) {
    parseError(location, "expected non-empty string");
  }
  return value;
}

export function parseBoolean(value: unknown, location: string): boolean {
  if (typeof value !== "boolean") parseError(location, "expected boolean");
  return value;
}

export function parseFiniteNumber(value: unknown, location: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    parseError(location, "expected finite number");
  }
  return value;
}

export function parseNonNegativeNumber(value: unknown, location: string): number {
  const number = parseFiniteNumber(value, location);
  if (number < 0) parseError(location, "expected non-negative number");
  return number;
}

export function parsePositiveInteger(value: unknown, location: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    parseError(location, "expected positive integer");
  }
  return value;
}

export function parseStringArray(value: unknown, location: string): string[] {
  if (!Array.isArray(value)) parseError(location, "expected array");
  return value.map((item, index) => parseString(item, `${location}[${index}]`));
}

export async function parseJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}
