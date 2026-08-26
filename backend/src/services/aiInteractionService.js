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

// present_featured — the ARCNAVE-safe form of the consumer platform's
// featured_card_display_v0. That tool shows "the one best pick", which
// is exactly what RS-AIG-013 forbids the AI from doing on an
// institutional judgement. The adaptation is structural, same technique
// buildOptionsCard already uses: this card cannot express a preference,
// only a *match*. `basis` is REQUIRED and must state the objective
// criterion the single result came from ("lowest attendance in
// III-ECE-A"), so the card always reads as "this is the record your
// filter returned", never "this is what I think you should pick". There
// is no `score`, `rank`, or `recommended` field to fill.
const MAX_BASIS_CHARS = 200;
const MAX_FEATURED_LABEL_CHARS = 120;
const MAX_FEATURED_FIELDS = 8;
const MAX_FIELD_LABEL_CHARS = 60;
const MAX_FIELD_VALUE_CHARS = 200;

function buildFeaturedCard(title, basis, fields) {
  const cleanTitle = requireNonEmptyString(title, 'title', MAX_FEATURED_LABEL_CHARS);
  const cleanBasis = requireNonEmptyString(basis, 'basis', MAX_BASIS_CHARS);
  if (!Array.isArray(fields) || fields.length === 0 || fields.length > MAX_FEATURED_FIELDS) {
    throw new AiInteractionValidationError(`fields must be an array of 1-${MAX_FEATURED_FIELDS} label/value pairs`);
  }
  const cleanedFields = fields.map((f) => {
    if (!f || typeof f !== 'object') {
      throw new AiInteractionValidationError('each field must be an object with a label and value');
    }
    return {
      label: requireNonEmptyString(f.label, 'each field label', MAX_FIELD_LABEL_CHARS),
      value: requireNonEmptyString(f.value, 'each field value', MAX_FIELD_VALUE_CHARS),
    };
  });
  return { title: cleanTitle, basis: cleanBasis, fields: cleanedFields };
}

// present_comparison — comparison_card_display_v0's ARCNAVE form. Same
// RS-AIG-013 property as present_options: every item is described on the
// SAME attributes and nothing marks a winner. There is deliberately no
// `verdict`/`best` field. Attributes are declared once and every item
// must supply exactly that set, so a model cannot quietly give one item
// a flattering extra row the others do not have.
const MIN_COMPARISON_ITEMS = 2;
const MAX_COMPARISON_ITEMS = 4;
const MAX_COMPARISON_ATTRIBUTES = 8;

function buildComparisonCard(title, attributes, items) {
  const cleanTitle = title ? requireNonEmptyString(title, 'title', MAX_TITLE_CHARS) : null;
  if (!Array.isArray(attributes) || attributes.length === 0 || attributes.length > MAX_COMPARISON_ATTRIBUTES) {
    throw new AiInteractionValidationError(`attributes must be an array of 1-${MAX_COMPARISON_ATTRIBUTES} shared attribute names`);
  }
  const cleanAttributes = attributes.map((a) => requireNonEmptyString(a, 'each attribute', MAX_FIELD_LABEL_CHARS));
  if (!Array.isArray(items) || items.length < MIN_COMPARISON_ITEMS || items.length > MAX_COMPARISON_ITEMS) {
    throw new AiInteractionValidationError(`items must be an array of ${MIN_COMPARISON_ITEMS}-${MAX_COMPARISON_ITEMS} things to compare`);
  }
  const cleanItems = items.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new AiInteractionValidationError('each item must be an object with a name and values');
    }
    const name = requireNonEmptyString(item.name, 'each item name', MAX_FEATURED_LABEL_CHARS);
    if (!Array.isArray(item.values) || item.values.length !== cleanAttributes.length) {
      throw new AiInteractionValidationError(`item ${JSON.stringify(name)} must supply exactly ${cleanAttributes.length} values, one per declared attribute`);
    }
    const values = item.values.map((v) => requireNonEmptyString(v, `each value for ${name}`, MAX_FIELD_VALUE_CHARS));
    return { name, values };
  });
  return { title: cleanTitle, attributes: cleanAttributes, items: cleanItems };
}

// present_carousel — product_carousel_display_v0's ARCNAVE form: a
// browsable set with no ordering claim. Order is caller-supplied and
// explicitly NOT a ranking; the shape has no score field, and the tool
// description says so. Larger cap than a comparison because browsing a
// set of electives/hostels/vendors is a real campus case.
const MIN_CAROUSEL_ITEMS = 2;
const MAX_CAROUSEL_ITEMS = 12;
const MAX_CAROUSEL_SUBTITLE_CHARS = 200;

function buildCarousel(title, items) {
  const cleanTitle = title ? requireNonEmptyString(title, 'title', MAX_TITLE_CHARS) : null;
  if (!Array.isArray(items) || items.length < MIN_CAROUSEL_ITEMS || items.length > MAX_CAROUSEL_ITEMS) {
    throw new AiInteractionValidationError(`items must be an array of ${MIN_CAROUSEL_ITEMS}-${MAX_CAROUSEL_ITEMS} entries`);
  }
  const cleanItems = items.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new AiInteractionValidationError('each item must be an object with a name');
    }
    return {
      name: requireNonEmptyString(item.name, 'each item name', MAX_FEATURED_LABEL_CHARS),
      subtitle: item.subtitle ? requireNonEmptyString(item.subtitle, 'each item subtitle', MAX_CAROUSEL_SUBTITLE_CHARS) : null,
    };
  });
  return { title: cleanTitle, items: cleanItems };
}

// present_links — link_preview_display_v0's ARCNAVE form. The one real
// safety property here is that a URL rendered as a card looks endorsed,
// and these URLs come from web_search results, which are untrusted data
// under RS-AIG-019/rule 9. So: http/https only (no javascript:, data:,
// file:), the host is surfaced separately so a lookalike domain is
// visible rather than hidden behind link text, and `untrusted: true`
// rides along on every card for the frontend to badge. Nothing here
// fetches anything — that is fetch_trusted_web_page's job, allowlisted.
const MIN_LINKS = 1;
const MAX_LINKS = 10;
const MAX_SNIPPET_CHARS = 300;
const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:']);

function buildLinkPreviews(links) {
  if (!Array.isArray(links) || links.length < MIN_LINKS || links.length > MAX_LINKS) {
    throw new AiInteractionValidationError(`links must be an array of ${MIN_LINKS}-${MAX_LINKS} entries`);
  }
  const cleanLinks = links.map((link) => {
    if (!link || typeof link !== 'object') {
      throw new AiInteractionValidationError('each link must be an object with a url and title');
    }
    const rawUrl = requireNonEmptyString(link.url, 'each link url', MAX_FIELD_VALUE_CHARS);
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (err) {
      throw new AiInteractionValidationError(`link url ${JSON.stringify(rawUrl)} is not a valid absolute URL`);
    }
    if (!ALLOWED_LINK_PROTOCOLS.has(parsed.protocol)) {
      throw new AiInteractionValidationError(`link url ${JSON.stringify(rawUrl)} must use http or https`);
    }
    return {
      url: parsed.toString(),
      host: parsed.host,
      title: requireNonEmptyString(link.title, 'each link title', MAX_FEATURED_LABEL_CHARS),
      snippet: link.snippet ? requireNonEmptyString(link.snippet, 'each link snippet', MAX_SNIPPET_CHARS) : null,
    };
  });
  return { links: cleanLinks, untrusted: true };
}

// present_places / present_map — places_list_display_v0 and
// places_map_display_v0's ARCNAVE forms. Deliberately NOT backed by
// Google Places: the consumer tools carry a mandatory-attribution
// obligation tied to that provider's data, and ARCNAVE has no such
// integration. These render places the CALLER already has — a campus
// block, an exam centre, a hostel — so there is no third-party data and
// no attribution requirement. Coordinates are range-checked; a place
// with no coordinates is still valid in a list, just not on a map.
const MIN_PLACES = 1;
const MAX_PLACES = 20;
const MAX_ADDRESS_CHARS = 300;

function cleanPlace(place, requireCoordinates) {
  if (!place || typeof place !== 'object') {
    throw new AiInteractionValidationError('each place must be an object with a name');
  }
  const name = requireNonEmptyString(place.name, 'each place name', MAX_FEATURED_LABEL_CHARS);
  const address = place.address ? requireNonEmptyString(place.address, 'each place address', MAX_ADDRESS_CHARS) : null;
  const hasCoordinates = place.latitude !== undefined || place.longitude !== undefined;
  if (requireCoordinates && !hasCoordinates) {
    throw new AiInteractionValidationError(`place ${JSON.stringify(name)} needs latitude and longitude to appear on a map`);
  }
  if (!hasCoordinates) return { name, address, latitude: null, longitude: null };
  const { latitude, longitude } = place;
  if (typeof latitude !== 'number' || latitude < -90 || latitude > 90) {
    throw new AiInteractionValidationError(`place ${JSON.stringify(name)} has an out-of-range latitude`);
  }
  if (typeof longitude !== 'number' || longitude < -180 || longitude > 180) {
    throw new AiInteractionValidationError(`place ${JSON.stringify(name)} has an out-of-range longitude`);
  }
  return { name, address, latitude, longitude };
}

function buildPlacesList(title, places) {
  const cleanTitle = title ? requireNonEmptyString(title, 'title', MAX_TITLE_CHARS) : null;
  if (!Array.isArray(places) || places.length < MIN_PLACES || places.length > MAX_PLACES) {
    throw new AiInteractionValidationError(`places must be an array of ${MIN_PLACES}-${MAX_PLACES} entries`);
  }
  return { title: cleanTitle, places: places.map((p) => cleanPlace(p, false)) };
}

function buildPlacesMap(title, places) {
  const cleanTitle = title ? requireNonEmptyString(title, 'title', MAX_TITLE_CHARS) : null;
  if (!Array.isArray(places) || places.length < MIN_PLACES || places.length > MAX_PLACES) {
    throw new AiInteractionValidationError(`places must be an array of ${MIN_PLACES}-${MAX_PLACES} entries`);
  }
  return { title: cleanTitle, places: places.map((p) => cleanPlace(p, true)) };
}

// present_recipe — recipe_display_v0's ARCNAVE form. The campus case is
// a mess/canteen menu costed per head, which is why `servings` is
// required and quantities are numeric: the whole point is that the
// frontend can rescale 40 servings to 400 without asking the model
// again. A free-text quantity ("a handful") would make that impossible,
// so it is rejected rather than accepted and silently un-scalable.
const MIN_INGREDIENTS = 1;
const MAX_INGREDIENTS = 40;
const MAX_UNIT_CHARS = 30;

function buildRecipe(title, servings, ingredients, steps) {
  const cleanTitle = requireNonEmptyString(title, 'title', MAX_TITLE_CHARS);
  if (!Number.isInteger(servings) || servings < 1) {
    throw new AiInteractionValidationError('servings must be a positive integer');
  }
  if (!Array.isArray(ingredients) || ingredients.length < MIN_INGREDIENTS || ingredients.length > MAX_INGREDIENTS) {
    throw new AiInteractionValidationError(`ingredients must be an array of ${MIN_INGREDIENTS}-${MAX_INGREDIENTS} entries`);
  }
  const cleanIngredients = ingredients.map((ing) => {
    if (!ing || typeof ing !== 'object') {
      throw new AiInteractionValidationError('each ingredient must be an object with a name and quantity');
    }
    const name = requireNonEmptyString(ing.name, 'each ingredient name', MAX_FIELD_LABEL_CHARS);
    if (typeof ing.quantity !== 'number' || !Number.isFinite(ing.quantity) || ing.quantity <= 0) {
      throw new AiInteractionValidationError(`ingredient ${JSON.stringify(name)} needs a positive numeric quantity so servings can be rescaled`);
    }
    return { name, quantity: ing.quantity, unit: requireNonEmptyString(ing.unit, `ingredient ${name}'s unit`, MAX_UNIT_CHARS) };
  });
  const { steps: cleanSteps } = buildSteps(null, steps);
  return {
    title: cleanTitle, servings, ingredients: cleanIngredients, steps: cleanSteps,
  };
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
  buildFeaturedCard,
  buildComparisonCard,
  buildCarousel,
  buildLinkPreviews,
  buildPlacesList,
  buildPlacesMap,
  buildRecipe,
};
