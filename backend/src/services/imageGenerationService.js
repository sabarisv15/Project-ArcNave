'use strict';

const configurationService = require('./configurationService');
const documentService = require('./documentService');

// AI image generation (RS-AIG-025) — off by default, per-college
// opt-in, mirroring webRetrievalService.js's own established pattern
// exactly: the same generic `configurations` category table (no new
// migration for the opt-in flag itself), the same "the Business Service
// itself throws a not-enabled error at call time — the tool stays
// listed, not filtered out of the offered tool list" shape
// fetchTrustedPage already uses (verified against that real code before
// mirroring it, not assumed).
//
// Which provider actually generates the image is never asserted here —
// this service calls whatever adapter configurationService.getAiConfig
// resolves for the college, exactly like every other AI capability in
// this codebase (RS-AIG-008). An adapter with no real vendor image API
// (claude/nim/self_hosted at present) throws AiProviderCapabilityError
// itself, the same shape claude.js's own missing embed() already uses —
// no adapter-name branch lives here or anywhere outside aiProviders/.

const CONFIG_CATEGORY = 'image_generation';
const MAX_PROMPT_LENGTH = 2000;

class ImageGenerationNotEnabledError extends Error {}
class ImageGenerationValidationError extends Error {}

async function getImageGenerationConfig(client, collegeId) {
  const row = await configurationService.getConfiguration(client, { collegeId, category: CONFIG_CATEGORY });
  const stored = row ? row.configuration : {};
  return { enabled: Boolean(stored.enabled) };
}

// Generates one image from a text prompt and immediately saves it as a
// real, downloadable document in the acting user's own Documents — same
// external shape as generate_document's own "the tool result IS a real
// file, not just described text" behavior, via the same
// DocumentService-owned storage path (CLAUDE.md rule 2). No Artifact
// wrapper here (unlike generate_document/export_artifact): a generated
// image has no markdown/JSON structured-editable form to publish FROM —
// it is binary from the moment it exists, so it goes straight through
// DocumentService, the same distinction ArtifactService's own ownership
// boundary already draws.
async function generateImage(client, { prompt }, { collegeId, actorUserId }) {
  if (!prompt || !String(prompt).trim()) {
    throw new ImageGenerationValidationError('prompt is required');
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new ImageGenerationValidationError(`prompt must be ${MAX_PROMPT_LENGTH} characters or fewer`);
  }

  const config = await getImageGenerationConfig(client, collegeId);
  if (!config.enabled) {
    throw new ImageGenerationNotEnabledError('image generation is not enabled for this college — opt in via configuration first');
  }

  const { adapter, config: aiConfig } = await configurationService.getAiConfig(client, collegeId);
  const { imageBuffer, mimeType } = await adapter.generateImage(aiConfig, { prompt: prompt.trim() });

  const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const fileName = `Generated image ${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;

  return documentService.uploadPersonalDocument(
    client,
    {
      collegeId,
      title: prompt.trim().slice(0, 120),
      folderName: 'AI Artifacts',
      fileName,
      mimeType,
      fileBuffer: imageBuffer,
    },
    { actorUserId },
  );
}

module.exports = {
  ImageGenerationNotEnabledError,
  ImageGenerationValidationError,
  CONFIG_CATEGORY,
  getImageGenerationConfig,
  generateImage,
};
