/**
 * Staff directory mock data. Local/mock only: the production app should swap
 * `STAFF` for the real staff API and keep the same shape.
 *
 * Shape
 *  Staff { id, employeeId, name, designation, department, phone, email, employmentType, updated }
 */

const DEPARTMENTS = ['Computer Science', 'Electronics', 'Mechanical', 'Civil', 'Mathematics'];
const DESIGNATIONS = [
  'Professor',
  'Associate Professor',
  'Assistant Professor',
  'Head of Department',
  'Lab Instructor',
  'Academic Coordinator',
];
const EMPLOYMENT_TYPES = ['Teaching', 'Non-teaching', 'Contract'];
const FIRST = [
  'Lakshmi',
  'Anand',
  'Fathima',
  'Girish',
  'Nandita',
  'Suresh',
  'Priya',
  'Ravi',
  'Deepa',
  'Manoj',
  'Kavitha',
  'Ashok',
  'Radha',
  'Vijay',
  'Shalini',
  'Naveen',
  'Geetha',
  'Prakash',
  'Uma',
  'Sathish',
];
const LAST = [
  'Narayanan',
  'Kulkarni',
  'Rasheed',
  'Menon',
  'Roy',
  'Iyer',
  'Krishnan',
  'Pillai',
  'Chandran',
  'Varma',
  'Subramanian',
  'Balan',
  'Raghavan',
  'Nambiar',
  'Devan',
];
const TITLES = ['Dr.', 'Prof.', 'Mr.', 'Ms.'];

export const SORTS = [
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'designation', label: 'Designation (A–Z)' },
  { key: 'department', label: 'Department (A–Z)' },
  { key: 'email', label: 'Email (A–Z)' },
];

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const rand = seeded(4242);
const pick = (list) => list[Math.floor(rand() * list.length)];

function phoneNumber() {
  let n = '9';
  for (let i = 0; i < 9; i++) n += Math.floor(rand() * 10);
  return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
}

function emailAddress(first, last) {
  return `${first}.${last}@arcnave.edu.in`.toLowerCase();
}

export const STAFF = Array.from({ length: 38 }, (_, i) => {
  const first = FIRST[i % FIRST.length];
  const last = LAST[(i * 3 + 1) % LAST.length];
  const name = `${pick(TITLES)} ${first} ${last}`;
  const daysAgo = Math.floor(rand() * 60);
  return {
    id: 'st' + (i + 1),
    employeeId: `EMP${String(2100 + i).padStart(4, '0')}`,
    name,
    designation: DESIGNATIONS[i % DESIGNATIONS.length],
    department: DEPARTMENTS[i % DEPARTMENTS.length],
    phone: phoneNumber(),
    email: emailAddress(first, last),
    employmentType: EMPLOYMENT_TYPES[i % EMPLOYMENT_TYPES.length],
    updatedDaysAgo: daysAgo,
    updated: daysAgo === 0 ? 'Updated today' : daysAgo === 1 ? 'Updated yesterday' : `Updated ${daysAgo} days ago`,
  };
});

export const STAFF_TOTAL = STAFF.length;
export const SCOPE_DEPTS = [...new Set(STAFF.map((s) => s.department))];
export const SCOPE_DESIGNATIONS = [...new Set(STAFF.map((s) => s.designation))];
export const SCOPE_EMPLOYMENT_TYPES = EMPLOYMENT_TYPES;

export function initials(name) {
  const parts = name.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.)\s*/, '').split(' ');
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
}
