/**
 * rpiv-config — inlined shim for @juicesharp/rpiv-config.
 * Uses @sinclair/typebox (already a little-coder dependency).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { Type, Value, type Static, type TObject } from "@sinclair/typebox";

function expandTilde(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

function defaultConfigDir(): string {
	return join(homedir(), ".config");
}

function resolveConfigDir(): string {
	const xdg = process.env["XDG_CONFIG_HOME"]?.trim();
	if (!xdg) return defaultConfigDir();
	const expanded = expandTilde(xdg);
	return isAbsolute(expanded) ? expanded : defaultConfigDir();
}

export function configPath(name: string, file?: string): string {
	const baseDir = resolveConfigDir();
	const dir = join(baseDir, name);
	if (file) return join(dir, file);
	return join(dir, "config.json");
}

function legacyConfigPath(name: string, file: string = "config.json"): string {
	return join(defaultConfigDir(), name, file);
}

export function loadJsonConfig<T>(path: string): T {
	if (!existsSync(path)) return {} as T;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {} as T;
		return parsed as T;
	} catch {
		return {} as T;
	}
}

export function loadJsonConfigWithLegacyFallback<T>(name: string, file?: string): T {
	const xdgPath = configPath(name, file);
	if (existsSync(xdgPath)) return loadJsonConfig<T>(xdgPath);
	return loadJsonConfig<T>(legacyConfigPath(name, file));
}

const CONFIG_FILE_MODE = 0o600;

export function saveJsonConfig(path: string, data: unknown): boolean {
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
	} catch { return false; }
	try { chmodSync(path, CONFIG_FILE_MODE); } catch { /* best-effort */ }
	return true;
}

export interface GuidanceFields {
	promptSnippet?: string;
	promptGuidelines?: string[];
}

export const GuidanceFieldsSchema = Type.Object(
	{
		promptSnippet: Type.Optional(Type.String()),
		promptGuidelines: Type.Optional(Type.Array(Type.String())),
	},
	{ additionalProperties: true },
);

export function validateGuidanceFields(fields: unknown): GuidanceFields {
	if (!fields || typeof fields !== "object") return {};
	const g = fields as Record<string, unknown>;
	const result: GuidanceFields = {};
	if (typeof g.promptSnippet === "string" && g.promptSnippet.length > 0) result.promptSnippet = g.promptSnippet;
	if (Array.isArray(g.promptGuidelines) && g.promptGuidelines.length > 0 && g.promptGuidelines.every((s: unknown) => typeof s === "string" && s.length > 0)) {
		result.promptGuidelines = g.promptGuidelines as string[];
	}
	return result;
}

export function parseModelKey(key: string): { provider: string; modelId: string } | undefined {
	const slashIdx = key.indexOf("/");
	if (slashIdx >= 1) return { provider: key.slice(0, slashIdx), modelId: key.slice(slashIdx + 1) };
	const colonIdx = key.indexOf(":");
	if (colonIdx >= 1) return { provider: key.slice(0, colonIdx), modelId: key.slice(colonIdx + 1) };
	return undefined;
}

export function modelKey(m: { provider?: string; id?: string }): string {
	return `${m.provider ?? "unknown"}/${m.id ?? "unknown"}`;
}

export function readEnvVar(key: string, fallback?: string): string | undefined {
	return process.env[key]?.trim() || fallback;
}

export const validateConfig = <T extends TObject>(schema: T, value: unknown): Static<T> => {
	try {
		if (value === null || typeof value !== "object" || Array.isArray(value)) return {} as Static<T>;
		const cleaned = Value.Clean(schema, Value.Clone(value));
		const defaults = Value.Create(schema);
		return { ...(defaults as Record<string, unknown>), ...(cleaned as Record<string, unknown>) } as Static<T>;
	} catch { return {} as Static<T>; }
};
