#!/usr/bin/env python3
"""Fixed, sandbox-shipped archive extraction — invoked directly by
server.js, never by LLM-supplied `code` (same reasoning as
transcode.py's own file comment: the safety bounds below must stay
developer-controlled, never something a generated script could omit).

Bounds enforced BEFORE any byte is written (ai-chat-file-intelligence-
router-approved-spec.md's Archive feature: "a violation of any limit
aborts the whole extraction... never a partial, silently-truncated
unpack"): every entry is validated in a first pass (count, per-entry
size, running total, path-traversal) before a second pass writes
anything, for both zip and tar. No recursion into nested archives
happens here — that policy (depth bound, re-classification of each
child) lives in the backend's archive-extraction service, one layer up;
this script only ever unpacks ONE archive, one level.
"""
import sys
import os
import json
import zipfile
import tarfile
import gzip
import shutil

MAX_ENTRIES = 200
MAX_TOTAL_BYTES = 500 * 1024 * 1024
MAX_SINGLE_ENTRY_BYTES = 500 * 1024 * 1024
COPY_CHUNK_BYTES = 1024 * 1024


def fail(reason, detail=None):
    print(json.dumps({'status': 'failed', 'reason': reason, 'detail': detail}))
    sys.exit(1)


def safe_join(base_dir, member_name):
    """Resolves member_name under base_dir, REJECTING (returning None)
    any entry whose path would escape it — deliberately a hard reject,
    not a silent strip-and-relocate. An earlier version of this
    function discarded '..'/'.'/empty components before joining, which
    made every traversal attempt land safely inside base_dir but never
    actually rejected the archive — caught live: 'traversal.zip'
    (a single entry named '../../evil.txt') returned status 'ok'
    instead of 'path_traversal_rejected'. Silently relocating a
    malicious name is a different bug class (multiple hostile entries
    can collide onto the same relocated name and silently overwrite
    each other) than a genuine escape, but the approved spec is
    explicit that a traversal entry aborts the whole extraction, so any
    '..' component anywhere in the name is rejected outright here."""
    normalized = member_name.replace('\\', '/')
    if normalized.startswith('/') or (len(normalized) > 1 and normalized[1] == ':'):
        return None  # absolute POSIX path, or a Windows drive-letter path
    parts = [part for part in normalized.split('/') if part not in ('', '.')]
    if not parts or '..' in parts:
        return None
    candidate = os.path.join(base_dir, *parts)
    candidate_abs = os.path.abspath(candidate)
    base_abs = os.path.abspath(base_dir)
    if candidate_abs != base_abs and not candidate_abs.startswith(base_abs + os.sep):
        return None
    return candidate_abs


def extract_zip(archive_path, out_dir):
    total = 0
    count = 0
    planned = []
    with zipfile.ZipFile(archive_path) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            count += 1
            if count > MAX_ENTRIES:
                fail('archive_limit_exceeded', 'more than %d entries' % MAX_ENTRIES)
            if info.file_size > MAX_SINGLE_ENTRY_BYTES:
                fail('archive_limit_exceeded', 'a single entry exceeds the size limit')
            total += info.file_size
            if total > MAX_TOTAL_BYTES:
                fail('archive_limit_exceeded', 'total uncompressed size exceeds the limit')
            dest = safe_join(out_dir, info.filename)
            if dest is None:
                fail('path_traversal_rejected', info.filename)
            planned.append((info, dest))

        for info, dest in planned:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with zf.open(info) as src, open(dest, 'wb') as out:
                shutil.copyfileobj(src, out, length=COPY_CHUNK_BYTES)
    return [os.path.relpath(dest, out_dir) for _, dest in planned]


def extract_tar(archive_path, out_dir):
    total = 0
    count = 0
    planned = []
    with tarfile.open(archive_path, 'r:*') as tf:
        for member in tf.getmembers():
            if member.issym() or member.islnk():
                # Never follow an archive-declared symlink/hardlink —
                # it could point outside out_dir regardless of the
                # member's own reported name.
                fail('path_traversal_rejected', member.name)
            if not member.isfile():
                continue
            count += 1
            if count > MAX_ENTRIES:
                fail('archive_limit_exceeded', 'more than %d entries' % MAX_ENTRIES)
            if member.size > MAX_SINGLE_ENTRY_BYTES:
                fail('archive_limit_exceeded', 'a single entry exceeds the size limit')
            total += member.size
            if total > MAX_TOTAL_BYTES:
                fail('archive_limit_exceeded', 'total uncompressed size exceeds the limit')
            dest = safe_join(out_dir, member.name)
            if dest is None:
                fail('path_traversal_rejected', member.name)
            planned.append((member, dest))

        for member, dest in planned:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            src = tf.extractfile(member)
            with open(dest, 'wb') as out:
                shutil.copyfileobj(src, out, length=COPY_CHUNK_BYTES)
    return [os.path.relpath(dest, out_dir) for _, dest in planned]


def extract_plain_gzip(archive_path, out_dir):
    # A bare .gz that is not a .tar.gz — one compressed file, decoded
    # under a fixed name (the original name is not recoverable from
    # gzip's own header in general, and is not needed: the child gets
    # re-classified by fileIntelligenceRouter from its own bytes, same
    # as every other archive child).
    dest = os.path.join(out_dir, 'decompressed.bin')
    total = 0
    with gzip.open(archive_path, 'rb') as src, open(dest, 'wb') as out:
        while True:
            chunk = src.read(COPY_CHUNK_BYTES)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_TOTAL_BYTES:
                fail('archive_limit_exceeded', 'decompressed size exceeds the limit')
            out.write(chunk)
    return [os.path.relpath(dest, out_dir)]


def main():
    if len(sys.argv) != 4:
        fail('invalid_arguments', 'usage: extract_archive.py <archivePath> <archiveKind> <outDir>')
    archive_path, archive_kind, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out_dir, exist_ok=True)

    try:
        if archive_kind == 'zip':
            names = extract_zip(archive_path, out_dir)
        elif archive_kind == 'tar':
            names = extract_tar(archive_path, out_dir)
        elif archive_kind == 'gzip':
            try:
                names = extract_tar(archive_path, out_dir)  # a .tar.gz is a tar, tarfile auto-detects gzip
            except tarfile.ReadError:
                names = extract_plain_gzip(archive_path, out_dir)
        else:
            fail('invalid_arguments', 'unknown archiveKind %r' % archive_kind)
    except (zipfile.BadZipFile, tarfile.TarError, OSError) as err:
        fail('corrupt_or_unreadable', type(err).__name__)
        return

    print(json.dumps({'status': 'ok', 'entries': names}))


if __name__ == '__main__':
    main()
