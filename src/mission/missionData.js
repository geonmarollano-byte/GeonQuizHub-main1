/**
 * GEON'S GAMEHUB - missionData.js
 * Start Your Mission: five missions, one per subject family (documented).
 * Mission names follow the documented examples ("The Supply Count",
 * "The Cooling Test", "The Pressure Choice", "The Safe System Check");
 * the fifth (TECH 2) name is an implementation detail.
 */
export const MISSIONS = Object.freeze([
  Object.freeze({
    id: 'm1',
    subject: 'MATH',
    name: 'The Supply Count',
    brief:
      'The barangay hall is preparing relief kits. You must verify the supply count before the truck leaves at noon.',
    question:
      'There are 8 boxes of relief goods. Each box holds 12 canned goods. The team already distributed 25 cans. How many cans remain?',
    choices: ['71', '96', '83', '59'],
    answer: '71',
    explanation: '8 x 12 = 96 cans; 96 - 25 = 71 cans remain.',
  }),
  Object.freeze({
    id: 'm2',
    subject: 'SCIENCE',
    name: 'The Cooling Test',
    brief:
      'A system unit keeps overheating in the lab. Diagnose the most likely cooling problem and choose the correct fix.',
    question:
      'A desktop computer shuts down after heavy use, and inspection shows thick dust on the CPU heatsink and fans. Which action addresses the ROOT cause?',
    choices: [
      'Clean the dust from the heatsink, fan, and vents to restore airflow',
      'Paint the heatsink a lighter color',
      'Run the computer only at night',
      'Remove the side panel permanently and never clean it',
    ],
    answer: 'Clean the dust from the heatsink, fan, and vents to restore airflow',
    explanation:
      'Dust insulates heat and blocks airflow, so cleaning restores proper cooling - the root cause of thermal shutdowns.',
  }),
  Object.freeze({
    id: 'm3',
    subject: 'PSYCHOLOGY',
    name: 'The Pressure Choice',
    brief:
      'Your group chat is pressuring everyone to skip the review session and mock anyone who disagrees. Choose the resilient response.',
    question:
      'Classmates say: "Everyone is skipping the review session. If you go, you are not one of us." Which response shows healthy resistance to negative peer pressure?',
    choices: [
      '"I hear you, but I am going - you should join if you want to pass too."',
      'Skip the session to avoid being teased.',
      'Say yes, then secretly not go and lie about it.',
      'Post an insult about them before they post about you.',
    ],
    answer: '"I hear you, but I am going - you should join if you want to pass too."',
    explanation:
      'A calm, clear refusal that respects both sides resists negative peer pressure without hostility.',
  }),
  Object.freeze({
    id: 'm4',
    subject: 'TECH 1',
    name: 'The Safe System Check',
    brief:
      'A client brings in a desktop that will not power on. Follow safe OHS procedure for the inspection.',
    question:
      'Before opening a customer system unit for inspection, what is the FIRST safety step?',
    choices: [
      'Turn the computer off, unplug the power cord, and ground yourself against static',
      'Open the case while it is still running to hear the fans',
      'Spray contact cleaner inside while powered',
      'Remove the CMOS battery with metal tweezers while plugged in',
    ],
    answer: 'Turn the computer off, unplug the power cord, and ground yourself against static',
    explanation:
      'Power must be fully removed and static controlled before any internal inspection - the core OHS rule.',
  }),
  Object.freeze({
    id: 'm5',
    subject: 'TECH 2',
    name: 'The Network Line',
    brief:
      'The school computer lab lost Internet on several PCs. Trace the problem from the workstation outward.',
    question:
      'One PC shows a 169.254.x.x address while others work normally on 192.168.1.x. What does this indicate?',
    choices: [
      'The PC failed to get an address from DHCP - check its cable/port and renew the address',
      'The monitor needs a driver',
      'The PC has a virus that changes addresses',
      '169.254.x.x is the normal address for lab PCs',
    ],
    answer: 'The PC failed to get an address from DHCP - check its cable/port and renew the address',
    explanation:
      '169.254.x.x (APIPA) means no DHCP reply was received - usually a physical link or port issue on that one PC.',
  }),
]);

export function missionCount() {
  return MISSIONS.length;
}
