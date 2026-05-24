import type { PageContextMetadata } from "@sidra/protocol";

export const SIDRA_CODEX_THREAD_TITLE_PREFIX = "Sidra: ";
export const SIDRA_CODEX_THREAD_TITLE_MAX_LENGTH = 60;
export const SIDRA_CODEX_THREAD_TITLE_MIN_PROMPT_LENGTH = 18;
export const SIDRA_CODEX_THREAD_TITLE_SEPARATOR = " - ";

const ELLIPSIS = "...";
const ESC = "\u001B";
const BEL = "\u0007";
const C1_CSI = "\u009B";
const C1_OSC = "\u009D";
const C1_ST = "\u009C";
const C1_STRING_CONTROL_INTRODUCERS = new Set(["\u0090", "\u0098", "\u009E", "\u009F"]);

export type SidraCodexThreadTitleInput = {
  prompt: string;
  pageMetadata?: Pick<PageContextMetadata, "title" | "canonicalUrl" | "url">;
};

export function buildSidraCodexThreadTitle(input: SidraCodexThreadTitleInput): string | undefined {
  const prompt = normalizeTitlePart(input.prompt);
  const pageIdentity = normalizeTitlePart(input.pageMetadata?.title) ?? pageHostname(input.pageMetadata);

  if (pageIdentity && prompt) return composeTitleWithPromptBudget(pageIdentity, prompt);
  if (prompt) return withPrefix(prompt);
  if (pageIdentity) return withPrefix(pageIdentity);
  return undefined;
}

function normalizeTitlePart(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  const withoutEscapes = stripAnsiEscapeSequences(value);
  const normalizedWhitespace = withoutEscapes.replace(/\s+/gu, " ");
  const withoutControls = stripControlAndFormatCharacters(normalizedWhitespace);
  const normalized = withoutControls.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function stripAnsiEscapeSequences(value: string): string {
  let sanitized = "";
  let index = 0;

  while (index < value.length) {
    const character = value[index];
    if (character === ESC) {
      index = skipEscSequence(value, index);
      continue;
    }
    if (character === C1_CSI) {
      index = skipControlSequence(value, index + 1);
      continue;
    }
    if (character === C1_OSC) {
      index = skipStringControlSequence(value, index + 1, true);
      continue;
    }
    if (C1_STRING_CONTROL_INTRODUCERS.has(character)) {
      index = skipStringControlSequence(value, index + 1, false);
      continue;
    }

    sanitized += character;
    index += 1;
  }

  return sanitized;
}

function stripControlAndFormatCharacters(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, "");
}

function hostnameFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname || undefined;
  } catch {
    return undefined;
  }
}

function truncateWithEllipsis(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= ELLIPSIS.length) return ELLIPSIS.slice(0, maxLength);
  return `${value.slice(0, maxLength - ELLIPSIS.length)}${ELLIPSIS}`;
}

function composeTitleWithPromptBudget(pageIdentity: string, prompt: string): string {
  const fullTitle = `${SIDRA_CODEX_THREAD_TITLE_PREFIX}${pageIdentity}${SIDRA_CODEX_THREAD_TITLE_SEPARATOR}${prompt}`;
  if (fullTitle.length <= SIDRA_CODEX_THREAD_TITLE_MAX_LENGTH) return fullTitle;

  const availableContentLength =
    SIDRA_CODEX_THREAD_TITLE_MAX_LENGTH -
    SIDRA_CODEX_THREAD_TITLE_PREFIX.length -
    SIDRA_CODEX_THREAD_TITLE_SEPARATOR.length;

  if (availableContentLength <= 0) return truncateWithEllipsis(SIDRA_CODEX_THREAD_TITLE_PREFIX, SIDRA_CODEX_THREAD_TITLE_MAX_LENGTH);

  const reservedPromptLength = Math.min(prompt.length, SIDRA_CODEX_THREAD_TITLE_MIN_PROMPT_LENGTH);
  const pageBudget = Math.max(0, availableContentLength - reservedPromptLength);
  const fittedPageIdentity = truncatePageIdentity(pageIdentity, pageBudget);
  const promptBudget = availableContentLength - fittedPageIdentity.length;
  const fittedPrompt = truncateWithEllipsis(prompt, promptBudget);

  return `${SIDRA_CODEX_THREAD_TITLE_PREFIX}${fittedPageIdentity}${SIDRA_CODEX_THREAD_TITLE_SEPARATOR}${fittedPrompt}`;
}

function pageHostname(pageMetadata: SidraCodexThreadTitleInput["pageMetadata"]): string | undefined {
  return hostnameFromUrl(pageMetadata?.canonicalUrl) ?? hostnameFromUrl(pageMetadata?.url);
}

function withPrefix(value: string): string {
  return `${SIDRA_CODEX_THREAD_TITLE_PREFIX}${truncateWithEllipsis(
    value,
    SIDRA_CODEX_THREAD_TITLE_MAX_LENGTH - SIDRA_CODEX_THREAD_TITLE_PREFIX.length
  )}`;
}

function truncatePageIdentity(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= ELLIPSIS.length) return ELLIPSIS.slice(0, maxLength);

  const visibleLength = maxLength - ELLIPSIS.length;
  const visibleText = value.slice(0, visibleLength);
  const lastWordBoundary = visibleText.lastIndexOf(" ");
  const readableText = lastWordBoundary > 0 ? visibleText.slice(0, lastWordBoundary) : visibleText;
  return `${readableText.trimEnd()}${ELLIPSIS}`;
}

function skipEscSequence(value: string, startIndex: number): number {
  const introducer = value[startIndex + 1];
  if (introducer === undefined) return value.length;
  if (introducer === "[") return skipControlSequence(value, startIndex + 2);
  if (introducer === "]") return skipStringControlSequence(value, startIndex + 2, true);
  if (introducer === "P" || introducer === "^" || introducer === "_" || introducer === "X") {
    return skipStringControlSequence(value, startIndex + 2, false);
  }
  return skipEscapeSequence(value, startIndex + 1);
}

function skipControlSequence(value: string, startIndex: number): number {
  let index = startIndex;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    index += 1;
    if (code >= 0x40 && code <= 0x7e) return index;
  }
  return value.length;
}

function skipStringControlSequence(value: string, startIndex: number, allowBelTerminator: boolean): number {
  let index = startIndex;
  while (index < value.length) {
    if ((allowBelTerminator && value[index] === BEL) || value[index] === C1_ST) return index + 1;
    if (value[index] === ESC && value[index + 1] === "\\") return index + 2;
    index += 1;
  }
  return value.length;
}

function skipEscapeSequence(value: string, startIndex: number): number {
  let index = startIndex;
  while (index < value.length && isEscapeIntermediateByte(value.charCodeAt(index))) {
    index += 1;
  }
  return index < value.length ? index + 1 : value.length;
}

function isEscapeIntermediateByte(code: number): boolean {
  return code >= 0x20 && code <= 0x2f;
}
