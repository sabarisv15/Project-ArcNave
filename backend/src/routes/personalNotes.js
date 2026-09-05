'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/rbac');
const personalNoteService = require('../services/personalNoteService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapPersonalNoteServiceError(err, res) {
  if (err instanceof personalNoteService.PersonalNoteValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof personalNoteService.PersonalNoteNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof personalNoteService.PersonalNoteForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

// requireAuth only — a personal note has no role-based access rule at
// all, only "must be the owner," which personalNoteService enforces
// itself. Every route implicitly scopes to identityService.resolveActorUserId(req.capabilities); nothing
// here ever accepts a userId from the request body/query.
const personalNoteIdParams = z.object({ id: z.string() });
const listPersonalNotesCalendarSchema = z.object({
  query: z.object({ from_date: z.string().optional(), to_date: z.string().optional() }).optional(),
});
const createPersonalNoteSchema = z.object({
  body: z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      reminder_at: z.string().optional(),
      note_date: z.string().optional(),
    })
    .optional(),
});
const updatePersonalNoteSchema = z.object({
  params: personalNoteIdParams,
  body: z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      reminder_at: z.string().optional(),
      is_done: z.any().optional(),
      note_date: z.string().optional(),
    })
    .optional(),
});
const deletePersonalNoteSchema = z.object({ params: personalNoteIdParams });

function createPersonalNotesRouter() {
  const router = express.Router();

  router.get(
    '/personal-notes',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const notes = await personalNoteService.listNotes(req.dbClient, {
        actorUserId: identityService.resolveActorUserId(req.capabilities),
      });
      res.json(notes);
    }),
  );

  // ADL-030 — the calendar grid's own read. Registered before
  // GET /personal-notes/:id would ever exist (it doesn't today, but
  // matches the "register the literal path first" convention staff.js's
  // /staff/me comment already established, for whenever it does).
  router.get(
    '/personal-notes/calendar',
    requireAuth,
    validate(listPersonalNotesCalendarSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { from_date: fromDate, to_date: toDate } = req.query || {};
      try {
        const notes = await personalNoteService.listNotesInRange(req.dbClient, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
          fromDate,
          toDate,
        });
        res.json(notes);
      } catch (err) {
        if (mapPersonalNoteServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.post(
    '/personal-notes',
    requireAuth,
    validate(createPersonalNoteSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { title, body, reminder_at: reminderAt, note_date: noteDate } = req.body || {};
      try {
        const note = await personalNoteService.createNote(
          req.dbClient,
          {
            title,
            body,
            reminderAt,
            noteDate,
          },
          { actorUserId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
        );
        res.status(201).json(note);
      } catch (err) {
        if (mapPersonalNoteServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.put(
    '/personal-notes/:id',
    requireAuth,
    validate(updatePersonalNoteSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { title, body, reminder_at: reminderAt, is_done: isDone, note_date: noteDate } = req.body || {};
      try {
        const note = await personalNoteService.updateNote(
          req.dbClient,
          req.params.id,
          {
            title,
            body,
            reminderAt,
            isDone,
            noteDate,
          },
          { actorUserId: identityService.resolveActorUserId(req.capabilities) },
        );
        res.json(note);
      } catch (err) {
        if (mapPersonalNoteServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  router.delete(
    '/personal-notes/:id',
    requireAuth,
    validate(deletePersonalNoteSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      try {
        await personalNoteService.deleteNote(req.dbClient, req.params.id, {
          actorUserId: identityService.resolveActorUserId(req.capabilities),
        });
        res.status(204).end();
      } catch (err) {
        if (mapPersonalNoteServiceError(err, res)) return;
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createPersonalNotesRouter;
module.exports.schemas = {
  '/personal-notes/calendar': { get: listPersonalNotesCalendarSchema },
  '/personal-notes': { post: createPersonalNoteSchema },
  '/personal-notes/{id}': { put: updatePersonalNoteSchema, delete: deletePersonalNoteSchema },
};
