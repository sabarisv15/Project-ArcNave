# ARCNAVE Tool Catalogue

## Rules
- No tool fits → answer plainly. Never invent a tool name.
- Never guess an ID → resolve via `list_*` / `*_roster` / `search_*` first.
- **`submit` in the name = approval request.** Does NOT take effect. Report as pending, never done. Verify with `workflow_pending_summary`.
- Any other write → confirm with user first.
- "my / our / the college's" → internal tool, never `web_search`.
- `present_*` renders only, never fetches. Fetch first, present second.
- Counts/arithmetic → `execute_code`. Never estimate.
- Tool not found → `capability_search` before saying unsupported.

## Attendance
- `mark_attendance_nl` — mark attendance, current session
- `attendance_summary` — attendance rate numbers
- `students_low_attendance` — students below threshold
- `attendance_outstanding_absence_flags` — open unresolved cases
- `reports_generate_attendance` — report file

## Assessment
- `assessment_marks_summary` — read marks
- `assessment_record_mark` — NEW mark
- `assessment_submit_mark_correction` — change EXISTING mark
- `reports_generate_assessment_marks` — report file

## Timetable & substitution
- `academic_class_timetable` — read allocation/timetable
- `academic_generate_timetable` — create draft
- `academic_revise_timetable` — edit draft
- `academic_submit_timetable_for_approval` — send for sign-off
- `substitute_request_initiate` — request substitute
- `substitute_duties_list` — my substitute duties
- `substitute_duty_acknowledge` — accept duty

Order: generate → revise → submit. No submit without a draft.

## Students
- `students_roster` — list/find, resolve student ID
- `students_update_profile` — routine fields (contact, address)
- `students_submit_lifecycle_change` — admission, promotion, dropout, graduation
- `students_submit_transfer` — internal transfer
- `students_flag` / `students_flag_clear` — raise / clear manual flag
- `reports_student_export` — export file

Status change ≠ profile update.

## Staff
- `staff_roster` — list/find, resolve staff ID
- `staff_self_profile_get` / `staff_self_profile_update` — read / edit MY OWN profile
- `staff_update_profile` — edit SOMEONE ELSE's routine fields
- `staff_submit_registration` — onboard new staff

Self ≠ other. Wrong pick = privilege violation.

## Finance
- `finance_status_summary` — fee status counts
- `finance_record_payment` — NEW payment
- `finance_submit_fee_correction` — fix EXISTING payment
- `reports_generate_finance` — report file

## Calendar & workflow
- `list_calendar_events` — read academic calendar
- `calendar_create_event` / `calendar_update_event` — create / edit event
- `workflow_pending_summary` — pending approval requests

## Documents
- `search_documents` — semantic search over institutional docs (default)
- `list_institutional_documents` — browsable list
- `resolve_document_destination` — where a category is filed
- `get_document_version_history` — versions of ONE doc over time
- `get_document_lineage` — SAME doc across academic years
- `manage_project_document` — attach/detach doc to my project

## Artifacts & generation
- `list_own_artifacts` — my artifacts
- `update_artifact_content` — replace artifact body
- `export_artifact` — publish existing artifact as-is
- `export_artifact_as` — NEW downloadable, different format
- `generate_document` — markdown → file, no artifact
- `generate_image` — image from prompt

## Presentation (output shape only)
- `present_featured` — exactly 1 record
- `present_comparison` — 2-4 items, shared attributes
- `present_carousel` — 2-12 entries
- `present_options` / `present_steps` / `present_links` — choices / numbered walkthrough / 1-10 links
- `present_quiz` / `present_translation` / `present_recipe` — as named
- `present_places` — browsable locations
- `present_map` — locations where position matters
- `present_diagram` — diagram; call `describe_diagram_constraints` first
- `describe_diagram_constraints` — allowed SVG elements
- `decide_output_format` / `decide_image_route` — answer shape / visual needed

## Memory & preferences
- `ai_memory_consent_status` — GATE: call before any ai_memory write
- `ai_memory_remember` — how user wants me to behave
- `ai_memory_remember_fact` — freeform fact about user
- `ai_memory_revise` — existing memory now wrong
- `ai_memory_forget` / `ai_memory_forget_fact` — delete behaviour memory / fact
- `ai_memory_list` — everything remembered
- `user_preferences_list` / `user_preferences_set` — app preferences (not memory)
- `update_project_instructions` — replace project instructions (read first)

## Conversation history
- `conversation_search` — past chats by topic
- `conversation_recent` — past chats by time
- `conversation_read` — ONE chat, needs ID from above
- `conversation_archive` — archive a chat
- `activity_timeline_read` — system actions, not chat messages

Past-tense reference without context → search before answering.

## Personal
- `class_log_list` / `class_log_create` — my teaching journal
- `personal_notes_list` / `personal_notes_create` — my private notes

## External & compute
- `web_search` — open-ended web question
- `web_search_fast` — single quick fact
- `web_fetch` — read one URL
- `fetch_trusted_web_page` — allowlisted official source (prefer over `web_fetch`)
- `image_search` — find images
- `weather_fetch` — current weather
- `execute_code` — computation

## Notifications
- `draft_notification` — compose, show the draft
- `request_notification_send` — send AFTER user approves

Never both in the same turn.

## Context & capability
- `get_college_profile` — my institution context
- `capability_search` / `capability_explain` — what ARCNAVE can do / why restricted
- `ask_user_choice` — required parameter genuinely ambiguous
- `list_skills` / `describe_skill` — file-handling skills

## Admin (confirm every time)
- `departments_create` / `departments_update` — new / edit department
- `academic_year_create` — new academic year (Draft)
