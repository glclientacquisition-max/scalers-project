const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Lightweight mirror of dashboard/src/lib/mvpAnswerReadiness.ts for Node tests.
 * Keep in sync when changing readiness rules.
 */
function assessMvpAnswerReadiness(input) {
  const hasText = (v, min = 1) => String(v || '').trim().length >= min;
  const asArray = (v) => (Array.isArray(v) ? v : []);
  const hasDid = (v) => {
    const value = String(v || '').trim();
    return Boolean(value) && !/^pending:/i.test(value);
  };
  const hasStructuredHours = (schedule) => {
    if (!schedule || typeof schedule !== 'object') return false;
    const days = schedule.days;
    if (!days || typeof days !== 'object') return false;
    return Object.values(days).some(
      (day) => day && typeof day === 'object' && 'open' in day
    );
  };
  const hasLocation = (locations) =>
    asArray(locations).some((row) => {
      if (!row || typeof row !== 'object') return false;
      return (
        hasText(row.landmark) || hasText(row.address) || hasText(row.directions)
      );
    });
  const hasFaqs = (faqs) =>
    asArray(faqs).some(
      (row) => row && hasText(row.question) && hasText(row.answer)
    );

  const items = [
    { id: 'did', required: true, ok: hasDid(input.sautikitVirtualNumber) },
    {
      id: 'prompt',
      required: true,
      ok: hasText(input.llmSystemPrompt, 80),
    },
    {
      id: 'identity',
      required: true,
      ok: hasText(input.agentName) && hasText(input.agentTone),
    },
    {
      id: 'hours',
      required: true,
      ok:
        hasText(input.businessHours, 8) ||
        hasStructuredHours(input.hoursSchedule),
    },
    {
      id: 'location',
      required: true,
      ok: hasLocation(input.businessLocations),
    },
    {
      id: 'faqs_or_fallback',
      required: true,
      ok:
        hasFaqs(input.faqs) || hasText(input.unknownAnswerFallback, 12),
    },
    {
      id: 'notify',
      required: true,
      ok:
        hasText(input.whatsappNotificationNumber, 8) ||
        hasText(input.alertEmail, 5),
    },
  ];
  const required = items.filter((i) => i.required);
  return {
    ready: required.every((i) => i.ok),
    requiredOk: required.filter((i) => i.ok).length,
    requiredTotal: required.length,
    items,
  };
}

describe('mvp answer readiness', () => {
  it('exports assessMvpAnswerReadiness from Desk lib', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../dashboard/src/lib/mvpAnswerReadiness.ts'),
      'utf8'
    );
    assert.match(src, /export function assessMvpAnswerReadiness/);
    assert.match(src, /Live phone number assigned/);
    assert.match(src, /Owner notify/);
  });

  it('is not ready with a pending DID', () => {
    const result = assessMvpAnswerReadiness({
      sautikitVirtualNumber: 'pending:abc',
      llmSystemPrompt: 'x'.repeat(100),
      agentName: 'Aisha',
      agentTone: 'friendly',
      businessHours: 'Monday – Saturday: 9:00 AM – 7:00 PM',
      businessLocations: [{ landmark: 'City Market' }],
      faqs: [{ question: 'Hours?', answer: '9–7' }],
      whatsappNotificationNumber: '+254700000000',
    });
    assert.equal(result.ready, false);
  });

  it('is ready when onboarded for unanswered-call answering', () => {
    const result = assessMvpAnswerReadiness({
      sautikitVirtualNumber: '+254709221536',
      llmSystemPrompt: 'x'.repeat(100),
      agentName: 'Aisha',
      agentTone: 'friendly',
      businessHours: 'Monday – Saturday: 9:00 AM – 7:00 PM',
      hoursSchedule: {
        days: { mon: { open: '09:00', close: '19:00' } },
      },
      businessLocations: [{ landmark: 'City Market' }],
      faqs: [{ question: 'Hours?', answer: '9–7' }],
      whatsappNotificationNumber: '+254700000000',
    });
    assert.equal(result.ready, true);
    assert.equal(result.requiredOk, result.requiredTotal);
  });
});

describe('retail onboarding pack (contract)', () => {
  it('ships hold/delivery FAQ starters for retail', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../dashboard/src/lib/retailOnboardingPack.ts'),
      'utf8'
    );
    assert.match(src, /Can you hold an item/);
    assert.match(src, /Do you deliver/);
    assert.match(src, /opening hours/i);
  });

  it('seeds hours schedule, team catch-all, and tools for MVP answer path', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../dashboard/src/lib/retailOnboardingPack.ts'),
      'utf8'
    );
    assert.match(src, /hoursScheduleFromOnboardingText/);
    assert.match(src, /seedOwnerCatchAllTeam/);
    assert.match(src, /General queries/);
    assert.match(src, /afterHoursMode/);
    assert.match(src, /agentTools/);
  });
});
