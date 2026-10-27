'use strict';

// Tenant rows for the VOICE_OPENING_V2 tests (tests/callOpening.test.js and
// tests/openingV2E2e.test.js). Shop names, personas and invites are the live
// ones from the greeting traces in briefs/v2-greeting-and-path-plan.md B1.
// Staff names are fixtures (never spoken): the banned-content test proves it.

const ALWAYS_OPEN = {
  timezone: 'Africa/Nairobi',
  days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].reduce((acc, d) => {
    acc[d] = { open: '00:00', close: '23:59' };
    return acc;
  }, {}),
};

const TENANTS = {
  aris: {
    id: '00000000-0000-4000-8000-0000000000a1',
    business_name: 'Aris - The Home of Affordable Stationery',
    spoken_name: null,
    agent_name: 'Lynn',
    greeting_invite: 'Tukusaidie vipi',
    vertical: 'retail',
    team_directory: [{ name: 'Chris', role: 'manager' }, { name: 'Mercy', role: 'cashier' }],
  },
  esga: {
    id: '00000000-0000-4000-8000-0000000000e5',
    business_name: 'Esga',
    spoken_name: null,
    agent_name: 'Lucy',
    greeting_invite: 'Nikusaidie vipi',
    vertical: 'retail',
    team_directory: [{ name: 'Brian', role: 'owner' }],
  },
  jirani: {
    id: '00000000-0000-4000-8000-0000000000c1',
    business_name: 'Jirani Cleaning Services Limited',
    spoken_name: 'Jirani Cleaning Services',
    agent_name: 'Wanjiru',
    greeting_invite: 'Nikusaidie vipi?',
    vertical: 'home_services',
    team_directory: [{ name: 'Alwyn', role: 'owner' }, { name: 'Grace', role: 'supervisor' }],
  },
};

module.exports = { TENANTS, ALWAYS_OPEN };
