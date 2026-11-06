import { describe, expect, it } from 'vitest';
import { buildFeedbackInsert, type FeedbackInsertInput } from './feedbackPayload';

const USER = { id: 'user-1', email: 'user@example.invalid' };
const base: FeedbackInsertInput = {
  type: 'bug',
  message: '  Broken button  ',
  contact: '   ',
  user: USER,
  currentLabId: null,
};

describe('buildFeedbackInsert', () => {
  it('trims the message and leaves an empty contact out', () => {
    expect(buildFeedbackInsert(base, 'agent')).toEqual({
      type: 'bug',
      message: 'Broken button',
      contact: null,
      user_email: 'user@example.invalid',
      user_id: 'user-1',
      user_agent: 'agent',
      lab_id: null,
      source_screen: null,
    });
  });

  it('records the lab only for a signed-in user in a lab space', () => {
    expect(buildFeedbackInsert({ ...base, currentLabId: 'lab-1' }, 'agent').lab_id).toBe('lab-1');
    expect(buildFeedbackInsert({ ...base, currentLabId: null }, 'agent').lab_id).toBeNull();
    const guest = buildFeedbackInsert({ ...base, user: null, currentLabId: 'lab-1' }, 'agent');
    expect(guest).toMatchObject({ lab_id: null, user_id: null, user_email: null });
  });

  it('passes the screen it was sent from through', () => {
    expect(buildFeedbackInsert({ ...base, sourceScreen: 'inventory' }, 'agent').source_screen).toBe('inventory');
    expect(buildFeedbackInsert({ ...base, contact: ' me@example.invalid ', sourceScreen: 'admin' }, 'agent'))
      .toMatchObject({ contact: 'me@example.invalid', source_screen: 'admin' });
  });
});
