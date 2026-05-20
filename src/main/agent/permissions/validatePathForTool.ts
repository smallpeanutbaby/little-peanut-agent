/**
 * Path validation wrapper used by filesystem tools. When a read/edit
 * target is missing, attach fuzzy-match hints so the model self-corrects
 * via Glob/Grep on the next turn instead of guessing again.
 */

import { validateProjectPath, type PathValidationResult } from "./pathValidation.js";
import { enrichFileNotFoundReason } from "./pathSuggestions.js";

export async function validatePathForTool(
  inputPath: string,
  projectRoot: string,
  options: {
    additionalWorkingDirectories?: string[];
    mustExist?: boolean;
    /** When true (default), missing files get "did you mean" hints. */
    suggestOnMissing?: boolean;
  } = {}
): Promise<PathValidationResult> {
  const result = await validateProjectPath(inputPath, projectRoot, options);
  if (
    result.ok ||
    !options.mustExist ||
    options.suggestOnMissing === false ||
    !result.reason?.startsWith("file does not exist:")
  ) {
    return result;
  }

  const absolute = result.reason.slice("file does not exist: ".length).trim();
  const enriched = await enrichFileNotFoundReason(projectRoot, inputPath, absolute);
  return { ...result, reason: enriched };
}
