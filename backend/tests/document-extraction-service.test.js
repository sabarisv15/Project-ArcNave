'use strict';

// Unit tests for documentExtractionService's pure/business-logic paths
// — tesseractOcr/pdfRasterizer/documentTypeRegistryRepository/
// configurationService are stubbed via node:test's built-in mock, same
// "fresh property lookup on the shared module object" reasoning every
// other service's own unit tests in this codebase rely on (see e.g.
// student-service.test.js's own file header comment).

const test = require('node:test');
const assert = require('node:assert/strict');
const tesseractOcr = require('../src/ocr/tesseractOcr');
const pdfRasterizer = require('../src/ocr/pdfRasterizer');
const documentTypeRegistryRepository = require('../src/repositories/documentTypeRegistryRepository');
const configurationService = require('../src/services/configurationService');
const documentExtractionService = require('../src/services/documentExtractionService');
const { flattenToPrompts } = require('../src/services/aiContextAssembly');

function mockAiConfig(t, completeImpl) {
  const m = t.mock.method(configurationService, 'getAiConfig', async () => ({
    provider: 'nim',
    config: { model: 'test-model-v1' },
    adapter: { complete: completeImpl },
  }));
  t.after(() => m.mock.restore());
  return m;
}

function mockOcrLangConfig(t, configuration = null) {
  const m = t.mock.method(configurationService, 'getConfiguration', async () => (
    configuration ? { configuration } : null
  ));
  t.after(() => m.mock.restore());
  return m;
}

test('documentExtractionService.extractFields', async (t) => {
  await t.test('aadhaar is hard-rejected before any registry lookup or OCR/AI call', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByKey');
    const aiMock = mockAiConfig(t, async () => { throw new Error('must not be called'); });
    t.after(() => registryMock.mock.restore());

    await assert.rejects(
      () => documentExtractionService.extractFields({}, { collegeId: 'c1', docType: 'aadhaar', text: 'some text' }),
      documentExtractionService.DocumentExtractionAadhaarBlockedError,
    );
    assert.equal(registryMock.mock.callCount(), 0);
    assert.equal(aiMock.mock.callCount(), 0);
  });

  await t.test('an unknown docType throws DocumentExtractionUnknownDocTypeError', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByKey', async () => null);
    t.after(() => registryMock.mock.restore());

    await assert.rejects(
      () => documentExtractionService.extractFields({}, { collegeId: 'c1', docType: 'not_real', text: 'x' }),
      documentExtractionService.DocumentExtractionUnknownDocTypeError,
    );
  });

  await t.test('a registry row with ocr_enabled: false (e.g. fee_receipt) returns empty fields, no AI call', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByKey', async () => ({
      key: 'fee_receipt', ocr_enabled: false, extraction_field_targets: [],
    }));
    const aiMock = mockAiConfig(t, async () => { throw new Error('must not be called'); });
    t.after(() => registryMock.mock.restore());

    const result = await documentExtractionService.extractFields({}, { collegeId: 'c1', docType: 'fee_receipt', text: 'x' });
    assert.deepEqual(result.fields, {});
    assert.equal(aiMock.mock.callCount(), 0);
  });

  await t.test('uses the registry\'s own extraction_field_targets, not a hardcoded list', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByKey', async () => ({
      key: 'marksheet_10th', ocr_enabled: true, extraction_field_targets: ['mark10th', 'schoolName'],
    }));
    let capturedPrompt;
    const aiMock = mockAiConfig(t, async (cfg, arcnaveContext) => {
      capturedPrompt = flattenToPrompts(arcnaveContext).systemPrompt;
      return JSON.stringify({
        mark10th: { value: '450/500', confidence: 90 },
        schoolName: { value: 'ABC School', confidence: 85 },
      });
    });
    t.after(() => registryMock.mock.restore());

    const result = await documentExtractionService.extractFields({}, { collegeId: 'c1', docType: 'marksheet_10th', text: 'ocr text' });
    assert.equal(aiMock.mock.callCount(), 1);
    assert.match(capturedPrompt, /mark10th/);
    assert.match(capturedPrompt, /schoolName/);
    assert.equal(result.fields.mark10th.value, '450/500');
    assert.equal(result.fields.mark10th.confidence, 90);
    assert.equal(result.fields.schoolName.value, 'ABC School');
  });

  await t.test('a malformed (non-JSON) LLM response falls back to null/0 per field, never throws', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByKey', async () => ({
      key: 'marksheet_10th', ocr_enabled: true, extraction_field_targets: ['mark10th', 'schoolName'],
    }));
    mockAiConfig(t, async () => 'this is not JSON at all');
    t.after(() => registryMock.mock.restore());

    const result = await documentExtractionService.extractFields({}, { collegeId: 'c1', docType: 'marksheet_10th', text: 'x' });
    assert.deepEqual(result.fields.mark10th, { value: null, confidence: 0 });
    assert.deepEqual(result.fields.schoolName, { value: null, confidence: 0 });
  });

  await t.test('a partially-populated LLM response fills in missing fields as null/0, not undefined', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByKey', async () => ({
      key: 'marksheet_10th', ocr_enabled: true, extraction_field_targets: ['mark10th', 'schoolName'],
    }));
    mockAiConfig(t, async () => JSON.stringify({ mark10th: { value: '450/500', confidence: 90 } }));
    t.after(() => registryMock.mock.restore());

    const result = await documentExtractionService.extractFields({}, { collegeId: 'c1', docType: 'marksheet_10th', text: 'x' });
    assert.equal(result.fields.mark10th.value, '450/500');
    assert.deepEqual(result.fields.schoolName, { value: null, confidence: 0 });
  });

  await t.test('a non-ISO dob (DD-MM-YYYY, as real transfer certificates use) is normalized to ISO before being returned', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByKey', async () => ({
      key: 'transfer_cert', ocr_enabled: true, extraction_field_targets: ['fullName', 'dob', 'gender'],
    }));
    mockAiConfig(t, async () => JSON.stringify({
      fullName: { value: 'Priya D', confidence: 95 },
      dob: { value: '22-03-2007', confidence: 90 },
      gender: { value: 'Female', confidence: 95 },
    }));
    t.after(() => registryMock.mock.restore());

    const result = await documentExtractionService.extractFields({}, { collegeId: 'c1', docType: 'transfer_cert', text: 'x' });
    assert.equal(result.fields.dob.value, '2007-03-22');
    assert.equal(result.fields.dob.confidence, 90);
  });

  await t.test('an unparseable dob is discarded to null/0 rather than ever reaching a DATE column malformed', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByKey', async () => ({
      key: 'transfer_cert', ocr_enabled: true, extraction_field_targets: ['dob'],
    }));
    mockAiConfig(t, async () => JSON.stringify({ dob: { value: '22nd March 2007', confidence: 90 } }));
    t.after(() => registryMock.mock.restore());

    const result = await documentExtractionService.extractFields({}, { collegeId: 'c1', docType: 'transfer_cert', text: 'x' });
    assert.deepEqual(result.fields.dob, { value: null, confidence: 0 });
  });

  await t.test('an already-ISO dob passes through unchanged', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByKey', async () => ({
      key: 'transfer_cert', ocr_enabled: true, extraction_field_targets: ['dob'],
    }));
    mockAiConfig(t, async () => JSON.stringify({ dob: { value: '2007-03-22', confidence: 90 } }));
    t.after(() => registryMock.mock.restore());

    const result = await documentExtractionService.extractFields({}, { collegeId: 'c1', docType: 'transfer_cert', text: 'x' });
    assert.deepEqual(result.fields.dob, { value: '2007-03-22', confidence: 90 });
  });

  await t.test('a non-dob field is never run through date normalization, even if it looks date-shaped', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByKey', async () => ({
      key: 'community_cert', ocr_enabled: true, extraction_field_targets: ['communityCertNumber'],
    }));
    mockAiConfig(t, async () => JSON.stringify({ communityCertNumber: { value: '22-03-2007', confidence: 90 } }));
    t.after(() => registryMock.mock.restore());

    const result = await documentExtractionService.extractFields({}, { collegeId: 'c1', docType: 'community_cert', text: 'x' });
    assert.deepEqual(result.fields.communityCertNumber, { value: '22-03-2007', confidence: 90 });
  });
});

test('documentExtractionService.normalizeExtractedDate', async (t) => {
  await t.test('DD-MM-YYYY and DD/MM/YYYY both normalize to ISO', () => {
    assert.equal(documentExtractionService.normalizeExtractedDate('22-03-2007'), '2007-03-22');
    assert.equal(documentExtractionService.normalizeExtractedDate('22/03/2007'), '2007-03-22');
    assert.equal(documentExtractionService.normalizeExtractedDate('1-1-2020'), '2020-01-01');
  });

  await t.test('an already-ISO value passes through when valid, rejected when not a real calendar date', () => {
    assert.equal(documentExtractionService.normalizeExtractedDate('2007-03-22'), '2007-03-22');
    assert.equal(documentExtractionService.normalizeExtractedDate('2007-02-30'), null);
  });

  await t.test('an out-of-range day/month (real Postgres crash scenario) resolves to null, never throws', () => {
    assert.equal(documentExtractionService.normalizeExtractedDate('32-13-2007'), null);
  });

  await t.test('free-text/unstructured dates resolve to null, not a guess', () => {
    assert.equal(documentExtractionService.normalizeExtractedDate('22nd March 2007'), null);
    assert.equal(documentExtractionService.normalizeExtractedDate('March 22, 2007'), null);
  });

  await t.test('non-string/empty/whitespace input resolves to null without throwing', () => {
    assert.equal(documentExtractionService.normalizeExtractedDate(null), null);
    assert.equal(documentExtractionService.normalizeExtractedDate(undefined), null);
    assert.equal(documentExtractionService.normalizeExtractedDate(42), null);
    assert.equal(documentExtractionService.normalizeExtractedDate('   '), null);
  });
});

test('documentExtractionService.classifyDocument', async (t) => {
  await t.test('returns the detected key and confidence when the LLM responds with valid JSON', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByModule', async () => [
      { key: 'marksheet_10th' }, { key: 'transfer_cert' },
    ]);
    mockOcrLangConfig(t);
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromImage', async () => ({ text: 'some ocr text', confidence: 91 }));
    mockAiConfig(t, async () => JSON.stringify({ detectedDocType: 'marksheet_10th', confidence: 97 }));
    t.after(() => {
      registryMock.mock.restore();
      ocrMock.mock.restore();
    });

    const result = await documentExtractionService.classifyDocument({}, {
      collegeId: 'c1', fileBuffer: Buffer.from('img'), mimeType: 'image/png',
    });
    assert.equal(result.detectedDocType, 'marksheet_10th');
    assert.equal(result.confidence, 97);
  });

  await t.test('a detectedDocType outside the known registry keys is treated as no match, not trusted blindly', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByModule', async () => [{ key: 'marksheet_10th' }]);
    mockOcrLangConfig(t);
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromImage', async () => ({ text: 'x', confidence: 80 }));
    mockAiConfig(t, async () => JSON.stringify({ detectedDocType: 'hallucinated_type', confidence: 99 }));
    t.after(() => {
      registryMock.mock.restore();
      ocrMock.mock.restore();
    });

    const result = await documentExtractionService.classifyDocument({}, {
      collegeId: 'c1', fileBuffer: Buffer.from('img'), mimeType: 'image/png',
    });
    assert.equal(result.detectedDocType, null);
  });

  await t.test('an unrecognized/discarded detectedDocType forces confidence to 0, never keeps the raw high confidence', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByModule', async () => [{ key: 'marksheet_10th' }]);
    mockOcrLangConfig(t);
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromImage', async () => ({ text: 'x', confidence: 80 }));
    mockAiConfig(t, async () => JSON.stringify({ detectedDocType: 'totally_unknown_type', confidence: 97 }));
    t.after(() => {
      registryMock.mock.restore();
      ocrMock.mock.restore();
    });

    const result = await documentExtractionService.classifyDocument({}, {
      collegeId: 'c1', fileBuffer: Buffer.from('img'), mimeType: 'image/png',
    });
    assert.equal(result.detectedDocType, null);
    assert.equal(result.confidence, 0);
  });

  await t.test('a known alias (e.g. "marksheet_12th" for the real key "marksheet_12th_iti") is normalized and accepted', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByModule', async () => [
      { key: 'marksheet_12th_iti' }, { key: 'transfer_cert' },
    ]);
    mockOcrLangConfig(t);
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromImage', async () => ({ text: 'x', confidence: 85 }));
    mockAiConfig(t, async () => JSON.stringify({ detectedDocType: 'marksheet_12th', confidence: 88 }));
    t.after(() => {
      registryMock.mock.restore();
      ocrMock.mock.restore();
    });

    const result = await documentExtractionService.classifyDocument({}, {
      collegeId: 'c1', fileBuffer: Buffer.from('img'), mimeType: 'image/png',
    });
    assert.equal(result.detectedDocType, 'marksheet_12th_iti');
    assert.equal(result.confidence, 88);
  });

  await t.test('an alias only normalizes when its canonical key is actually a live candidate this call', async () => {
    // Same "marksheet_12th" model output, but this registry snapshot
    // doesn't even offer "marksheet_12th_iti" as a candidate — the
    // alias must not be trusted blindly; it still has to resolve
    // against the CURRENT candidateKeys, same as an exact match would.
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByModule', async () => [{ key: 'transfer_cert' }]);
    mockOcrLangConfig(t);
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromImage', async () => ({ text: 'x', confidence: 85 }));
    mockAiConfig(t, async () => JSON.stringify({ detectedDocType: 'marksheet_12th', confidence: 88 }));
    t.after(() => {
      registryMock.mock.restore();
      ocrMock.mock.restore();
    });

    const result = await documentExtractionService.classifyDocument({}, {
      collegeId: 'c1', fileBuffer: Buffer.from('img'), mimeType: 'image/png',
    });
    assert.equal(result.detectedDocType, null);
    assert.equal(result.confidence, 0);
  });

  await t.test('canonicalization is case/separator-insensitive (whitespace, hyphens, mixed case)', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByModule', async () => [{ key: 'bank_passbook' }]);
    mockOcrLangConfig(t);
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromImage', async () => ({ text: 'x', confidence: 85 }));
    mockAiConfig(t, async () => JSON.stringify({ detectedDocType: ' Bank-Passbook ', confidence: 91 }));
    t.after(() => {
      registryMock.mock.restore();
      ocrMock.mock.restore();
    });

    const result = await documentExtractionService.classifyDocument({}, {
      collegeId: 'c1', fileBuffer: Buffer.from('img'), mimeType: 'image/png',
    });
    assert.equal(result.detectedDocType, 'bank_passbook');
    assert.equal(result.confidence, 91);
  });

  await t.test('the raw model output is always preserved on the result, whether accepted or discarded', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByModule', async () => [{ key: 'marksheet_10th' }]);
    mockOcrLangConfig(t);
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromImage', async () => ({ text: 'x', confidence: 85 }));
    mockAiConfig(t, async () => '{"detectedDocType": "nonsense_type", "confidence": 55}');
    t.after(() => {
      registryMock.mock.restore();
      ocrMock.mock.restore();
    });

    const result = await documentExtractionService.classifyDocument({}, {
      collegeId: 'c1', fileBuffer: Buffer.from('img'), mimeType: 'image/png',
    });
    assert.equal(result.rawModelOutput, '{"detectedDocType": "nonsense_type", "confidence": 55}');
  });

  await t.test('a non-JSON raw response is discarded with confidence 0, but still preserved as rawModelOutput', async () => {
    const registryMock = t.mock.method(documentTypeRegistryRepository, 'findByModule', async () => [{ key: 'marksheet_10th' }]);
    mockOcrLangConfig(t);
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromImage', async () => ({ text: 'x', confidence: 85 }));
    mockAiConfig(t, async () => 'this is not JSON at all');
    t.after(() => {
      registryMock.mock.restore();
      ocrMock.mock.restore();
    });

    const result = await documentExtractionService.classifyDocument({}, {
      collegeId: 'c1', fileBuffer: Buffer.from('img'), mimeType: 'image/png',
    });
    assert.equal(result.detectedDocType, null);
    assert.equal(result.confidence, 0);
    assert.equal(result.rawModelOutput, 'this is not JSON at all');
  });
});

test('documentExtractionService.normalizeDetectedDocType', async (t) => {
  await t.test('exact candidate keys pass through unchanged', () => {
    assert.equal(
      documentExtractionService.normalizeDetectedDocType('marksheet_10th', ['marksheet_10th', 'transfer_cert']),
      'marksheet_10th',
    );
  });

  await t.test('every documented alias maps to its real registry key when that key is a live candidate', () => {
    const cases = [
      ['marksheet_12th', 'marksheet_12th_iti'],
      ['twelfth_marksheet', 'marksheet_12th_iti'],
      ['tenth_marksheet', 'marksheet_10th'],
      ['transfer_certificate', 'transfer_cert'],
      ['tc', 'transfer_cert'],
      ['community_certificate', 'community_cert'],
      ['passbook', 'bank_passbook'],
      ['fee_receipts', 'fee_receipt'],
      ['aadhar', 'aadhaar'],
      ['photo', 'student_photo'],
    ];
    const allCanonicalKeys = [
      'marksheet_12th_iti', 'marksheet_10th', 'transfer_cert', 'community_cert',
      'bank_passbook', 'fee_receipt', 'aadhaar', 'student_photo',
    ];
    for (const [input, expected] of cases) {
      assert.equal(documentExtractionService.normalizeDetectedDocType(input, allCanonicalKeys), expected, `alias ${input}`);
    }
  });

  await t.test('an alias whose canonical key is not a live candidate resolves to null, never a guess', () => {
    assert.equal(documentExtractionService.normalizeDetectedDocType('marksheet_12th', ['transfer_cert']), null);
  });

  await t.test('an unrecognized value with no alias resolves to null', () => {
    assert.equal(documentExtractionService.normalizeDetectedDocType('completely_made_up', ['marksheet_10th']), null);
  });

  await t.test('non-string/empty/whitespace-only input resolves to null without throwing', () => {
    assert.equal(documentExtractionService.normalizeDetectedDocType(null, ['marksheet_10th']), null);
    assert.equal(documentExtractionService.normalizeDetectedDocType(undefined, ['marksheet_10th']), null);
    assert.equal(documentExtractionService.normalizeDetectedDocType(42, ['marksheet_10th']), null);
    assert.equal(documentExtractionService.normalizeDetectedDocType('   ', ['marksheet_10th']), null);
  });

  await t.test('whitespace/hyphen/case variants of a real key normalize to the same candidate', () => {
    assert.equal(documentExtractionService.normalizeDetectedDocType('Marksheet-10TH', ['marksheet_10th']), 'marksheet_10th');
    assert.equal(documentExtractionService.normalizeDetectedDocType('  marksheet_10th  ', ['marksheet_10th']), 'marksheet_10th');
  });
});

test('documentExtractionService.runOcr', async (t) => {
  await t.test('an image mimeType runs a single OCR pass, no rasterization', async () => {
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromImage', async () => ({ text: 'hello', confidence: 88 }));
    const rasterMock = t.mock.method(pdfRasterizer, 'rasterizePdfToImages', async () => { throw new Error('must not be called'); });
    t.after(() => {
      ocrMock.mock.restore();
      rasterMock.mock.restore();
    });

    const result = await documentExtractionService.runOcr(Buffer.from('img'), 'image/png');
    assert.equal(result.text, 'hello');
    assert.equal(result.ocrConfidence, 88);
    assert.equal(rasterMock.mock.callCount(), 0);
  });

  await t.test('a PDF rasterizes to pages, OCRs each, concatenates text, and averages confidence across pages', async () => {
    const rasterMock = t.mock.method(pdfRasterizer, 'rasterizePdfToImages', async () => [Buffer.from('p1'), Buffer.from('p2')]);
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromPages', async () => [
      { text: 'page one', confidence: 80 },
      { text: 'page two', confidence: 60 },
    ]);
    t.after(() => {
      rasterMock.mock.restore();
      ocrMock.mock.restore();
    });

    const result = await documentExtractionService.runOcr(Buffer.from('pdf'), 'application/pdf');
    assert.equal(result.text, 'page one\n\npage two');
    assert.equal(result.ocrConfidence, 70);
  });

  await t.test('an unsupported mimeType is a validation error, never reaches Tesseract', async () => {
    const ocrMock = t.mock.method(tesseractOcr, 'extractTextFromImage', async () => { throw new Error('must not be called'); });
    t.after(() => ocrMock.mock.restore());

    await assert.rejects(
      () => documentExtractionService.runOcr(Buffer.from('x'), 'application/zip'),
      documentExtractionService.DocumentExtractionValidationError,
    );
  });
});

test('documentExtractionService.overallConfidence / needsReview', async (t) => {
  await t.test('overallConfidence weights AI confidence higher than OCR confidence (0.6 vs 0.4)', () => {
    assert.equal(documentExtractionService.overallConfidence(90, 90), 90);
    assert.equal(documentExtractionService.overallConfidence(50, 95), 77);
    assert.equal(documentExtractionService.overallConfidence(95, 50), 68);
  });

  await t.test('needsReview flags on any of the three independent thresholds, not just the blended overall', () => {
    assert.equal(documentExtractionService.needsReview(90, 90, 90), false);
    assert.equal(documentExtractionService.needsReview(50, 95, documentExtractionService.overallConfidence(50, 95)), true, 'low OCR confidence alone should flag');
    assert.equal(documentExtractionService.needsReview(95, 60, documentExtractionService.overallConfidence(95, 60)), true, 'low AI confidence alone should flag');
    assert.equal(documentExtractionService.needsReview(80, 80, 85), true, 'overall below 90 should flag even if neither individual threshold trips');
  });
});

test('documentExtractionService.mergeFieldsAcrossDocuments', async (t) => {
  await t.test('identical values across documents are accepted, not flagged as a conflict', () => {
    const merged = documentExtractionService.mergeFieldsAcrossDocuments([
      { docType: 'transfer_cert', ocrConfidence: 90, fields: { fullName: { value: 'Aarav Sharma', confidence: 95 } } },
      { docType: 'marksheet_10th', ocrConfidence: 85, fields: { fullName: { value: 'Aarav Sharma', confidence: 90 } } },
    ]);
    assert.equal(merged.fullName.conflict, false);
    assert.equal(merged.fullName.value, 'Aarav Sharma');
    assert.equal(merged.fullName.candidates.length, 2);
  });

  await t.test('disagreeing values across documents are flagged as a conflict with every candidate retained', () => {
    const merged = documentExtractionService.mergeFieldsAcrossDocuments([
      { docType: 'transfer_cert', ocrConfidence: 90, fields: { dob: { value: '2008-01-01', confidence: 95 } } },
      { docType: 'marksheet_10th', ocrConfidence: 85, fields: { dob: { value: '2008-02-02', confidence: 90 } } },
    ]);
    assert.equal(merged.dob.conflict, true);
    assert.equal(merged.dob.candidates.length, 2);
    assert.deepEqual(merged.dob.candidates.map((c) => c.sourceDocType), ['transfer_cert', 'marksheet_10th']);
  });

  await t.test('a null value from one document is skipped, never treated as a real candidate', () => {
    const merged = documentExtractionService.mergeFieldsAcrossDocuments([
      { docType: 'transfer_cert', ocrConfidence: 90, fields: { gender: { value: null, confidence: 0 } } },
      { docType: 'marksheet_10th', ocrConfidence: 85, fields: { gender: { value: 'Male', confidence: 90 } } },
    ]);
    assert.equal(merged.gender.conflict, false);
    assert.equal(merged.gender.value, 'Male');
    assert.equal(merged.gender.candidates.length, 1);
  });
});

test('documentExtractionService.buildReviewChecklist', async (t) => {
  await t.test('surfaces a merge conflict as its own checklist item', () => {
    const merged = documentExtractionService.mergeFieldsAcrossDocuments([
      { docType: 'transfer_cert', ocrConfidence: 95, fields: { dob: { value: '2008-01-01', confidence: 95 } } },
      { docType: 'marksheet_10th', ocrConfidence: 95, fields: { dob: { value: '2008-02-02', confidence: 95 } } },
    ]);
    const checklist = documentExtractionService.buildReviewChecklist(merged, {});
    assert.equal(checklist.some((item) => item.type === 'conflict' && item.field === 'dob'), true);
  });

  await t.test('surfaces a low-confidence non-conflicting field', () => {
    const merged = documentExtractionService.mergeFieldsAcrossDocuments([
      { docType: 'marksheet_10th', ocrConfidence: 40, fields: { schoolName: { value: 'ABC', confidence: 40 } } },
    ]);
    const checklist = documentExtractionService.buildReviewChecklist(merged, {});
    assert.equal(checklist.some((item) => item.type === 'low_confidence' && item.field === 'schoolName'), true);
  });

  await t.test('a confident, agreeing field produces no checklist item', () => {
    const merged = documentExtractionService.mergeFieldsAcrossDocuments([
      { docType: 'marksheet_10th', ocrConfidence: 95, fields: { schoolName: { value: 'ABC', confidence: 95 } } },
    ]);
    const checklist = documentExtractionService.buildReviewChecklist(merged, {});
    assert.equal(checklist.some((item) => item.field === 'schoolName'), false);
  });

  await t.test('format validators: a malformed IFSC, a wrong-length pincode, and a wrong-length phone are all flagged', () => {
    const checklist = documentExtractionService.buildReviewChecklist({}, {
      bankIfscCode: 'NOTVALID', pincode: '60004', phone: '99887766011',
    });
    assert.equal(checklist.some((i) => i.type === 'format' && i.field === 'bankIfscCode'), true);
    assert.equal(checklist.some((i) => i.type === 'format' && i.field === 'pincode'), true);
    assert.equal(checklist.some((i) => i.type === 'format' && i.field === 'phone'), true);
  });

  await t.test('a valid IFSC/pincode/phone produce no format items', () => {
    const checklist = documentExtractionService.buildReviewChecklist({}, {
      bankIfscCode: 'HDFC0001234', pincode: '600040', phone: '9988776601',
    });
    assert.equal(checklist.some((i) => i.type === 'format'), false);
  });
});
