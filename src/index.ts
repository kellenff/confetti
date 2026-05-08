// Public API surface for confetti.

// Core
export { defineConfig } from "./pipeline.js";
export type { Config, DefineConfigOptions } from "./pipeline.js";

// Sources
export { overrideSource } from "./sources/override.js";
export { defaultsSource } from "./sources/defaults.js";
export { flagsSource } from "./sources/flags.js";
export { fileSource } from "./sources/file.js";
export { envSource } from "./sources/env.js";

// Errors + type guards
export {
  AggregatedConfigError,
  isAggregatedConfigError,
  ParseError,
  isParseError,
} from "./errors.js";
export type { ConfigIssue } from "./errors.js";

// Types (the public Source/Parser/Runtime contracts so users can build their own)
export type {
  Source,
  Parser,
  Runtime,
  Unwatch,
  ReloadHandler,
  ErrorHandler,
  ConfigDiff,
  SourceName,
  StandardPriorityValue,
} from "./types.js";
export { StandardPriority } from "./types.js";

// Schema-walker error (so users can catch UnsupportedSchemaError surface)
export {
  UnsupportedSchemaError,
  isUnsupportedSchemaError,
} from "./env-keys/unsupported.js";
