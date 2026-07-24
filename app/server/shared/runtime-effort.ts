type RuntimeEffortModelsDefinition = {
  OPTIONS?: Array<{ value: string; effort?: { values?: Array<{ value: string }> } }>;
};

/**
 * Resolve the effort level a provider run should use.
 *
 * Shared by the Claude and OpenCode runtimes, which had byte-identical copies:
 * find the model in the catalog, read its allowed effort values, and honor the
 * requested effort only when the model actually supports it and it isn't the
 * 'default' sentinel. Returns undefined ("let the provider decide") otherwise.
 */
export function resolveRuntimeEffort(
  model: string,
  effort: unknown,
  modelsDefinition: RuntimeEffortModelsDefinition | undefined,
): string | undefined {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option) => option.value === model) || null;
  const allowedEfforts = selectedModel?.effort?.values?.map((value) => value.value) || [];
  return typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort
    : undefined;
}
