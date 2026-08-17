'use strict';

// Generic per-user preference store (UAT Priority 2 #6/#7 + the
// recommended Personal Dashboard Configuration feature) — see the
// user_preferences migration's own comment for why one table/service
// serves Saved Filters, Dashboard Layout, and Notification Preferences
// as different preferenceKey values rather than three separate
// tables/services. No allow-list of valid keys here: the frontend
// owns what keys it introduces, same "backend stores, frontend
// defines the shape" split configurationService.js already draws for
// institution-level configuration categories.

const userPreferenceRepository = require('../repositories/userPreferenceRepository');

class UserPreferenceValidationError extends Error {}

function assertValidKey(preferenceKey) {
  if (!preferenceKey || typeof preferenceKey !== 'string') {
    throw new UserPreferenceValidationError('preferenceKey is required');
  }
}

async function setPreference(client, preferenceKey, value, { actorUserId, collegeId }) {
  assertValidKey(preferenceKey);
  if (value === undefined) {
    throw new UserPreferenceValidationError('value is required');
  }
  return userPreferenceRepository.upsert(client, {
    collegeId, userId: actorUserId, preferenceKey, value,
  });
}

async function getPreference(client, preferenceKey, { actorUserId }) {
  assertValidKey(preferenceKey);
  return userPreferenceRepository.findByUserAndKey(client, actorUserId, preferenceKey);
}

async function listPreferences(client, { actorUserId }) {
  return userPreferenceRepository.listByUser(client, actorUserId);
}

async function deletePreference(client, preferenceKey, { actorUserId }) {
  assertValidKey(preferenceKey);
  await userPreferenceRepository.remove(client, actorUserId, preferenceKey);
}

module.exports = {
  UserPreferenceValidationError,
  setPreference,
  getPreference,
  listPreferences,
  deletePreference,
};
