'use strict';

// AI Interaction Service — presentation-only helpers with no data access.
// There is no repository, no table, no tenant/actor dimension behind a
// clarifying question, so there is nothing for this to wrap in the usual
// "Business Service over a repository" sense. It exists as its own thin
// service anyway, rather than letting the ask_user_choice tool's handler
// in aiToolRegistry.js validate/shape its own params inline, so that
// registration still follows CLAUDE.md rule 1 ("every AI tool calls a
// Business Service") the same way every other tool in that file does —
// no handler contains its own validation/shaping logic, full stop, not
// "except when there's nothing to look up."

class AiInteractionValidationError extends Error {}

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MAX_OPTION_CHARS = 80;
const MAX_PROMPT_CHARS = 200;

function requireNonEmptyString(value, label, maxChars) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AiInteractionValidationError(`${label} is required and must be a non-empty string`);
  }
  if (maxChars && value.length > maxChars) {
    throw new AiInteractionValidationError(`${label} must be at most ${maxChars} characters`);
  }
  return value.trim();
}

function buildChoicePrompt(prompt, options) {
  const cleanPrompt = requireNonEmptyString(prompt, 'prompt', MAX_PROMPT_CHARS);
  if (!Array.isArray(options) || options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    throw new AiInteractionValidationError(`options must be an array of ${MIN_OPTIONS}-${MAX_OPTIONS} short choices`);
  }
  const cleanedOptions = options.map((opt) => requireNonEmptyString(opt, 'each option', MAX_OPTION_CHARS));
  return { prompt: cleanPrompt, options: cleanedOptions };
}

// present_options — a neutral, unranked "here are the alternatives" card.
// RS-AIG-013 ("AI is advisory, never decisive, on institutional
// judgements") is the reason this never accepts an ordering/ranking
// field or a "recommended" flag: the validated shape has no way to mark
// one option as better than another, so a model cannot smuggle a
// best-pick framing through this tool even if it wanted to — the
// omission is the safety property, not a missing feature.
const MIN_PRESENT_OPTIONS = 2;
const MAX_PRESENT_OPTIONS = 6;
const MAX_OPTION_LABEL_CHARS = 80;
const MAX_OPTION_DESCRIPTION_CHARS = 300;
const MAX_TITLE_CHARS = 120;

function buildOptionsCard(title, options) {
  const cleanTitle = title ? requireNonEmptyString(title, 'title', MAX_TITLE_CHARS) : null;
  if (!Array.isArray(options) || options.length < MIN_PRESENT_OPTIONS || options.length > MAX_PRESENT_OPTIONS) {
    throw new AiInteractionValidationError(`options must be an array of ${MIN_PRESENT_OPTIONS}-${MAX_PRESENT_OPTIONS} alternatives`);
  }
  const cleanedOptions = options.map((opt) => {
    if (!opt || typeof opt !== 'object') {
      throw new AiInteractionValidationError('each option must be an object with a label');
    }
    const label = requireNonEmptyString(opt.label, 'each option label', MAX_OPTION_LABEL_CHARS);
    const description = opt.description
      ? requireNonEmptyString(opt.description, 'each option description', MAX_OPTION_DESCRIPTION_CHARS)
      : null;
    return { label, description };
  });
  return { title: cleanTitle, options: cleanedOptions };
}

// present_quiz — the model has already generated the questions (that is
// an LLM's own ordinary job, same as writing any other answer); this
// tool only validates and structures that output for interactive
// rendering. correctIndex is bounds-checked against that same question's
// own options array, never trusted as a bare number.
const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 10;
const MIN_QUIZ_OPTIONS = 2;
const MAX_QUIZ_OPTIONS = 6;
const MAX_QUESTION_CHARS = 300;

function buildQuiz(title, questions) {
  const cleanTitle = title ? requireNonEmptyString(title, 'title', MAX_TITLE_CHARS) : null;
  if (!Array.isArray(questions) || questions.length < MIN_QUESTIONS || questions.length > MAX_QUESTIONS) {
    throw new AiInteractionValidationError(`questions must be an array of ${MIN_QUESTIONS}-${MAX_QUESTIONS} items`);
  }
  const cleanedQuestions = questions.map((q, index) => {
    if (!q || typeof q !== 'object') {
      throw new AiInteractionValidationError(`question ${index + 1} must be an object`);
    }
    const question = requireNonEmptyString(q.question, `question ${index + 1}'s text`, MAX_QUESTION_CHARS);
    if (!Array.isArray(q.options) || q.options.length < MIN_QUIZ_OPTIONS || q.options.length > MAX_QUIZ_OPTIONS) {
      throw new AiInteractionValidationError(`question ${index + 1} must have ${MIN_QUIZ_OPTIONS}-${MAX_QUIZ_OPTIONS} options`);
    }
    const options = q.options.map((opt) => requireNonEmptyString(opt, `question ${index + 1}'s option`, MAX_OPTION_LABEL_CHARS));
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= options.length) {
      throw new AiInteractionValidationError(`question ${index + 1}'s correctIndex must be a valid index into its own options`);
    }
    return { question, options, correctIndex: q.correctIndex };
  });
  return { title: cleanTitle, questions: cleanedQuestions };
}

// present_translation — the model has already produced the translation;
// this only structures source/target for a side-by-side rendering.
const MAX_TRANSLATION_TEXT_CHARS = 2000;
const MAX_LANG_CHARS = 40;

function buildTranslationCard(sourceText, sourceLang, targetText, targetLang) {
  return {
    sourceText: requireNonEmptyString(sourceText, 'sourceText', MAX_TRANSLATION_TEXT_CHARS),
    sourceLang: sourceLang ? requireNonEmptyString(sourceLang, 'sourceLang', MAX_LANG_CHARS) : null,
    targetText: requireNonEmptyString(targetText, 'targetText', MAX_TRANSLATION_TEXT_CHARS),
    targetLang: requireNonEmptyString(targetLang, 'targetLang', MAX_LANG_CHARS),
  };
}

// present_steps — a numbered walkthrough over static instructions the
// model already knows (e.g. "how do I submit a fee correction"), never
// over live tool data — a step sequence describing a real ARCNAVE action
// still only ever executes through the ordinary tool-call path, calling
// this tool has no side effect of its own.
const MIN_STEPS = 1;
const MAX_STEPS = 15;
const MAX_STEP_CHARS = 300;

function buildSteps(title, steps) {
  const cleanTitle = title ? requireNonEmptyString(title, 'title', MAX_TITLE_CHARS) : null;
  if (!Array.isArray(steps) || steps.length < MIN_STEPS || steps.length > MAX_STEPS) {
    throw new AiInteractionValidationError(`steps must be an array of ${MIN_STEPS}-${MAX_STEPS} items`);
  }
  const cleanedSteps = steps.map((s) => requireNonEmptyString(s, 'each step', MAX_STEP_CHARS));
  return { title: cleanTitle, steps: cleanedSteps };
}

module.exports = {
  AiInteractionValidationError,
  MIN_OPTIONS,
  MAX_OPTIONS,
  buildChoicePrompt,
  buildOptionsCard,
  buildQuiz,
  buildTranslationCard,
  buildSteps,
};
