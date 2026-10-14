// Class 9 Science — Motion (PLAN §11). Odia + English.
// STATUS: all Odia text is a DRAFT written without the textbook — needs native review (TODO D6, C.7)
// and the BSE Odisha chapter (TODO D3) for term choices and passages. Draft items do not move mastery.
// Every number below comes from `solve` (PLAN §6.1), never typed by hand.

import {
  averageSpeed, averageVelocity, kmphToMps, pathDistanceDisplacement, circularPath, solveSuvat,
  type ChapterPack, type CheckItem, type Explanation, type Utterance, type CheckOption,
} from '@setu/core';

const OD = (n: number | string) => String(n).replace(/[0-9]/g, (d) => String.fromCodePoint(0x0b66 + Number(d)));
const u = (or: string, en: string, speak?: { or?: string; en?: string }): Utterance => ({
  display: { or, en },
  ...(speak ? { speak: Object.fromEntries(Object.entries(speak).filter(([, v]) => v)) as Record<string, string> } : {}),
});
const draft = { or: 'draft', en: 'draft' } as const;

const exp: Explanation[] = [];
const explain = (conceptId: string, n: number, strategy: Explanation['strategy'], level: number, body: Utterance, targets?: string[], regions?: string[]) =>
  exp.push({ id: `exp.${conceptId}.${strategy}.${n}@1`, conceptId, strategy, level, body, targets, ...(regions ? { regions } : {}), review: { ...draft } });
/** a local analogy for one region (P3.22, PLAN §7.1.5) — no numbers, so nothing for the solver to check */
const local = (conceptId: string, n: number, region: string, or: string, en: string) => explain(conceptId, n, 'analogy', 2, u(or, en), undefined, [region]);

const checks: CheckItem[] = [];
const opt = (id: string, or: string, en: string, correct = false, misconceptionIds: string[] = [], fb?: [string, string]): CheckOption =>
  ({ id, text: { or, en }, correct, misconceptionIds, ...(fb ? { feedback: { or: fb[0], en: fb[1] } } : {}) });
const mcq = (id: string, conceptId: string, difficulty: 1 | 2 | 3, stem: Utterance, options: CheckOption[], placement = false) =>
  checks.push({ id: `chk.${id}@1`, conceptId, kind: 'mcq', stem, options, review: { ...draft }, difficulty, ...(placement ? { placement } : {}) });
const numeric = (id: string, conceptId: string, difficulty: 1 | 2 | 3, stem: Utterance, value: number, dim: 'length' | 'time' | 'speed' | 'acceleration', solveRef: string) =>
  checks.push({ id: `chk.${id}@1`, conceptId, kind: 'numeric', stem, numeric: { value, dim, solveRef }, review: { ...draft }, difficulty });

/** a short written answer: graded on its key ideas (any script), weak evidence offline, LLM-graded online (P2.42) */
const written = (id: string, conceptId: string, stem: Utterance, keyIdeas: Record<string, string>[], model: [string, string]) =>
  checks.push({ id: `chk.${id}@1`, conceptId, kind: 'text', stem, keyIdeas, model: { or: model[0], en: model[1] }, review: { ...draft }, difficulty: 2 });

// ---------- numbers (all from solve) ----------
const walk = pathDistanceDisplacement([[3, 0], [0, 4]]); // {distance 7, displacement 5}
const roundTripKm = pathDistanceDisplacement([[2, 0], [-2, 0]]); // {distance 4, displacement 0}
const busSpeed = averageSpeed(90, 2); // 45 km/h
const busMps = kmphToMps(busSpeed); // 12.5 m/s
const tripTime = 60 / 20 + 60 / 30; // 3 h + 2 h
const tripAvg = averageSpeed(120, tripTime); // 24 km/h
const cycleSpeed = averageSpeed(1200, 300); // 4 m/s
const halfCircle = circularPath(7, 0.5); // track radius 7 m
const roundTripVel = averageVelocity(roundTripKm.displacement, 1); // 0
const k36 = kmphToMps(36); // 10 m/s
const accel = (k: { u: number; v: number; t: number }) => { const r = solveSuvat(k); if (!r.ok) throw new Error(r.error); return r.values.a; };
const busStart = accel({ u: 0, v: 20, t: 5 }); // 4 m/s²
const cycleBrake = accel({ u: 10, v: 0, t: 5 }); // −2 m/s²
const trainUp = accel({ u: 5, v: 15, t: 4 }); // 2.5 m/s²
const goat = pathDistanceDisplacement([[5, 0], [-2, 0]]); // {distance 7, displacement 3}
const sprint = averageSpeed(100, 20); // 5 m/s

// ---------- reference point ----------
explain('reference_point', 1, 'definition', 2, u(
  'କୌଣସି ଜିନିଷ ଗତି କରୁଛି କି ନାହିଁ, ତାହା ଜାଣିବା ପାଇଁ ଆମେ ତାକୁ ଗୋଟିଏ ସ୍ଥିର ସ୍ଥାନ ସହିତ ତୁଳନା କରୁ। ସେହି ସ୍ଥାନକୁ ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ (Reference point) କୁହାଯାଏ। "ମୋ ଘର ସ୍କୁଲଠାରୁ ୨ କିଲୋମିଟର ଦୂର" — ଏଠାରେ ସ୍କୁଲ ହେଉଛି ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ।',
  'To tell whether something is moving, we compare it with a fixed place. That place is called the reference point (origin). "My house is 2 km from the school" — here the school is the reference point.',
  { or: 'କୌଣସି ଜିନିଷ ଗତି କରୁଛି କି ନାହିଁ, ତାହା ଜାଣିବା ପାଇଁ ଆମେ ତାକୁ ଗୋଟିଏ ସ୍ଥିର ସ୍ଥାନ ସହିତ ତୁଳନା କରୁ। ସେହି ସ୍ଥାନକୁ ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ କୁହାଯାଏ। ମୋ ଘର ସ୍କୁଲଠାରୁ ଦୁଇ କିଲୋମିଟର ଦୂର — ଏଠାରେ ସ୍କୁଲ ହେଉଛି ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ।' },
));
explain('reference_point', 2, 'analogy', 2, u(
  'ତୁମେ ଚାଲୁଥିବା ବସ୍‌ରେ ବସିଛ। ବସ୍ ଭିତରେ ଥିବା ସାଙ୍ଗ ପାଇଁ ତୁମେ ସ୍ଥିର — ତୁମେ ହଲୁନାହଁ। କିନ୍ତୁ ରାସ୍ତା କଡ଼ରେ ଠିଆ ହୋଇଥିବା ଲୋକ ପାଇଁ ତୁମେ ଗତି କରୁଛ। ତେଣୁ ଗତି ସବୁବେଳେ କାହା ସହିତ ତୁଳନାରେ — ସେଇଟା ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ।',
  'You are sitting in a moving bus. For your friend inside the bus you are at rest. For a person standing by the road you are moving. So motion is always compared with something — that is the reference point.',
));
mcq('ref.1', 'reference_point', 1, u(
  'ମୀନା ଚାଲୁଥିବା ଟ୍ରେନ୍‌ରେ ବସିଛି। ଟ୍ରେନ୍‌ର ଝରକା ତୁଳନାରେ ମୀନା —',
  'Meena sits in a moving train. Compared with the train window, Meena is —',
), [
  opt('a', 'ସ୍ଥିର', 'at rest', true),
  opt('b', 'ଗତିଶୀଳ', 'moving', false, ['motion_is_absolute'], ['ଝରକା ବି ତା ସହିତ ଯାଉଛି — ଦୁହିଁଙ୍କ ମଧ୍ୟରେ ଦୂରତା ବଦଳୁନି।', 'The window moves with her — the distance between them does not change.']),
  opt('c', 'କହିହେବ ନାହିଁ', 'cannot say', false, ['motion_is_absolute']),
], true);
mcq('ref.2', 'reference_point', 1, u(
  '"ପୋଖରୀ ମନ୍ଦିରଠାରୁ ୫୦୦ ମିଟର ପୂର୍ବରେ" — ଏଠାରେ ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ କଣ?',
  '"The pond is 500 m east of the temple" — what is the reference point here?',
), [
  opt('a', 'ପୋଖରୀ', 'the pond'),
  opt('b', 'ମନ୍ଦିର', 'the temple', true),
  opt('c', 'ପୂର୍ବ ଦିଗ', 'the east direction'),
]); // (one placement item per concept is enough at the root; acceleration took the slot, C.6)
explain('reference_point', 3, 'contrast', 3, u(
  'ଡଙ୍ଗାରେ ବସିଥିବା ମାଛଧରାଳି ପାଇଁ ଡଙ୍ଗା ଭିତରର ଜାଲ ସ୍ଥିର। କିନ୍ତୁ ନଦୀ କୂଳରେ ଠିଆ ହୋଇଥିବା ପିଲା ପାଇଁ ସେହି ଜାଲ ଗତି କରୁଛି। ଗୋଟିଏ ଜିନିଷ, ଦୁଇଟି ଉତ୍ତର — କାରଣ ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ ଅଲଗା। ତେଣୁ "ଗତି କରୁଛି କି?" ପଚାରିବା ଆଗରୁ ପଚାର — "କାହା ତୁଳନାରେ?"',
  'For a fisherman sitting in a boat, the net in the boat is at rest. For a child standing on the river bank, the same net is moving. One object, two answers — because the reference points are different. So before asking "is it moving?", ask "compared with what?"',
), ['motion_is_absolute']);
explain('reference_point', 4, 'story', 1, u(
  'ରୀନା ଷ୍ଟେସନରେ ଟ୍ରେନ୍ ଭିତରେ ବସିଥିଲା। ପାଖ ଲାଇନର ଟ୍ରେନ୍ ଚାଲିଲା, କିନ୍ତୁ ରୀନାକୁ ଲାଗିଲା ତା’ ନିଜ ଟ୍ରେନ୍ ଚାଲୁଛି! ସେ ପ୍ଲାଟଫର୍ମର ଖୁଣ୍ଟକୁ ଚାହିଁଲା — ଖୁଣ୍ଟ ହଲୁନି। ସେତେବେଳେ ବୁଝିଲା, ତା’ ଟ୍ରେନ୍ ସ୍ଥିର। ସେହି ଖୁଣ୍ଟ ହେଲା ତା’ର ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ।',
  'Rina was sitting in a train at the station. The train on the next track started, but Rina felt her own train was moving! She looked at a pole on the platform — the pole was not moving. Then she understood that her train was at rest. That pole became her reference point.',
), ['motion_is_absolute']);
mcq('ref.3', 'reference_point', 2, u(
  'ରାସ୍ତା କଡ଼ର ଗଛ ତୁଳନାରେ ଚାଲୁଥିବା ବସ୍‌ର ଡ୍ରାଇଭର —',
  'Compared with a tree by the road, the driver of a moving bus is —',
), [
  opt('a', 'ଗତି କରୁଛି', 'moving', true),
  opt('b', 'ସ୍ଥିର', 'at rest', false, [], ['ବସ୍ ଭିତରେ ସେ ସ୍ଥିର, କିନ୍ତୁ ଗଛ ତୁଳନାରେ ତା’ ସ୍ଥାନ ବଦଳୁଛି।', 'Inside the bus he is at rest, but compared with the tree his position is changing.']),
  opt('c', 'କହିହେବ ନାହିଁ', 'cannot say', false, ['motion_is_absolute']),
]);
mcq('ref.4', 'reference_point', 2, u(
  'ଗୋଟିଏ ଜିନିଷ ଏକା ସମୟରେ ସ୍ଥିର ଓ ଗତିଶୀଳ ଦୁଇଟି ହୋଇପାରିବ କି?',
  'Can one object be at rest and moving at the same time?',
), [
  opt('a', 'ନା, କେବେ ବି ନୁହେଁ', 'no, never', false, ['motion_is_absolute'], ['ବସ୍‌ରେ ବସିଥିବା ତୁମେ ସାଙ୍ଗ ପାଇଁ ସ୍ଥିର, ରାସ୍ତା କଡ଼ର ଲୋକ ପାଇଁ ଗତିଶୀଳ।', 'Sitting in a bus you are at rest for your friend and moving for a person by the road.']),
  opt('b', 'ହଁ, ଅଲଗା ଅଲଗା ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ ତୁଳନାରେ', 'yes, compared with different reference points', true),
  opt('c', 'କେବଳ ରାତିରେ', 'only at night'),
]);
mcq('ref.5', 'reference_point', 1, u(
  'କିଛି ଗତି କରୁଛି କି ନାହିଁ କହିବା ପାଇଁ କଣ ଦରକାର?',
  'What do we need to say whether something is moving?',
), [
  opt('a', 'ଗୋଟିଏ ସ୍ଥିର ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ', 'a fixed reference point', true),
  opt('b', 'ଗୋଟିଏ ଘଣ୍ଟା', 'a clock'),
  opt('c', 'କିଛି ଦରକାର ନାହିଁ', 'nothing at all', false, ['motion_is_absolute']),
]);
mcq('ref.6', 'reference_point', 2, u(
  'ନଦୀ ସ୍ରୋତରେ ଭାସୁଥିବା ପତ୍ର ଉପରେ ଗୋଟିଏ ପିମ୍ପୁଡ଼ି ବସିଛି। ପତ୍ର ତୁଳନାରେ ପିମ୍ପୁଡ଼ି —',
  'An ant sits on a leaf floating down a river. Compared with the leaf, the ant is —',
), [
  opt('a', 'ସ୍ଥିର', 'at rest', true),
  opt('b', 'ଗତି କରୁଛି', 'moving', false, ['motion_is_absolute'], ['ପତ୍ର ବି ତା’ ସହିତ ଭାସୁଛି — ଦୁହିଁଙ୍କ ମଧ୍ୟରେ ଦୂରତା ବଦଳୁନି।', 'The leaf floats along with it — the distance between them does not change.']),
  opt('c', 'କହିହେବ ନାହିଁ', 'cannot say', false, ['motion_is_absolute']),
]);

// ---------- distance ----------
explain('distance', 1, 'definition', 3, u(
  'ଦୂରତା (Distance) ହେଉଛି ଗୋଟିଏ ବସ୍ତୁ ପ୍ରକୃତରେ ଯେତିକି ବାଟ ଯାଇଛି, ତାହାର ମୋଟ ଲମ୍ବ। ବାଟ ସିଧା ହେଉ କି ବଙ୍କା — ସବୁ ବାଟ ଯୋଡ଼ାଯାଏ। ଦୂରତାରେ କେବଳ ପରିମାଣ ଥାଏ, ଦିଗ ନଥାଏ, ତେଣୁ ଏହା ଏକ ଅଦିଶ ରାଶି (scalar)। ଏକକ: ମିଟର (m)।',
  'Distance is the total length of the path an object actually travels. Straight or winding — every part of the path is added. Distance has only size, no direction, so it is a scalar. Unit: metre (m).',
  { or: 'ଦୂରତା ହେଉଛି ଗୋଟିଏ ବସ୍ତୁ ପ୍ରକୃତରେ ଯେତିକି ବାଟ ଯାଇଛି, ତାହାର ମୋଟ ଲମ୍ବ। ବାଟ ସିଧା ହେଉ କି ବଙ୍କା, ସବୁ ବାଟ ଯୋଡ଼ାଯାଏ। ଦୂରତାରେ କେବଳ ପରିମାଣ ଥାଏ, ଦିଗ ନଥାଏ, ତେଣୁ ଏହା ଏକ ଅଦିଶ ରାଶି। ଏହାର ଏକକ ମିଟର।', en: 'Distance is the total length of the path an object actually travels. Straight or winding, every part of the path is added. Distance has only size, no direction, so it is a scalar. Its unit is the metre.' },
));
explain('distance', 2, 'analogy', 2, u(
  'ଘରୁ ହାଟକୁ ଯିବା ବାଟ ବିଲ ହିଡ଼ ଦେଇ ବୁଲି ବୁଲି ଯାଏ। ତୁମ ଗୋଡ଼ ଯେତିକି ବାଟ ଚାଲିଲା — ସେଇଟା ହିଁ ଦୂରତା। ବାଟ ଯେତେ ବଙ୍କା, ଦୂରତା ସେତେ ବେଶୀ।',
  'The path from home to the haat winds along the paddy-field bunds. However much ground your feet covered — that is the distance. The more winding the path, the larger the distance.',
));
explain('distance', 3, 'worked_example', 3, u(
  `ସୀମା ପୂର୍ବ ଦିଗକୁ ${OD(3)} ମିଟର ଚାଲିଲା, ତା'ପରେ ଉତ୍ତର ଦିଗକୁ ${OD(4)} ମିଟର ଚାଲିଲା। ମୋଟ ଦୂରତା = ${OD(3)} + ${OD(4)} = ${OD(walk.distance)} ମିଟର। ଦୂରତା ପାଇଁ ଆମେ କେବଳ ସବୁ ବାଟ ଯୋଡ଼ିଦେଉ, ଦିଗ ଦେଖୁ ନାହିଁ।`,
  `Seema walks 3 m east, then 4 m north. Total distance = 3 + 4 = ${walk.distance} m. For distance we just add up all the path, ignoring direction.`,
  { or: `ସୀମା ପୂର୍ବ ଦିଗକୁ ତିନି ମିଟର ଚାଲିଲା, ତା'ପରେ ଉତ୍ତର ଦିଗକୁ ଚାରି ମିଟର ଚାଲିଲା। ମୋଟ ଦୂରତା ତିନି ଯୁକ୍ତ ଚାରି, ସମାନ ସାତ ମିଟର। ଦୂରତା ପାଇଁ ଆମେ କେବଳ ସବୁ ବାଟ ଯୋଡ଼ିଦେଉ, ଦିଗ ଦେଖୁ ନାହିଁ।` },
));
explain('distance', 4, 'story', 1, u(
  'ପିମ୍ପୁଡ଼ିଟିଏ କାନ୍ଥରେ ଉପରକୁ ଚଢ଼ିଲା, ପୁଣି ତଳକୁ ଓହ୍ଲାଇଲା। ସେ ଯେତିକି ବାଟ ଚାଲିଲା, ସବୁ ମିଶାଇଲେ ତା\'ର ଦୂରତା।',
  'An ant climbed up a wall and came back down. Everything it walked, added together, is its distance.',
));
mcq('dist.1', 'distance', 1, u(
  'ଦୂରତା ବିଷୟରେ କେଉଁଟି ଠିକ୍?',
  'Which is true about distance?',
), [
  opt('a', 'ଏଥିରେ ପରିମାଣ ଓ ଦିଗ ଦୁଇଟି ଥାଏ', 'It has size and direction', false, ['distance_has_direction']),
  opt('b', 'ଏଥିରେ କେବଳ ପରିମାଣ ଥାଏ', 'It has only size', true),
  opt('c', 'ଏହା କେବଳ ସିଧା ବାଟରେ ମପାଯାଏ', 'It is measured only along straight paths', false, ['distance_is_straight_line']),
], true);
numeric('dist.2', 'distance', 2, u(
  `ରବି ପୂର୍ବକୁ ${OD(3)} ମି. ଓ ତା'ପରେ ଉତ୍ତରକୁ ${OD(4)} ମି. ଚାଲିଲା। ମୋଟ ଦୂରତା କେତେ? (ମିଟରରେ)`,
  'Ravi walks 3 m east and then 4 m north. What is the total distance? (in metres)',
), walk.distance, 'length', 'path([[3,0],[0,4]]).distance');
mcq('dist.3', 'distance', 2, u(
  `ଗୋଟିଏ ପିଲା ${OD(7)} ମି. ବ୍ୟାସାର୍ଦ୍ଧର ବୃତ୍ତାକାର ପଡ଼ିଆର ଅଧା ବୁଲିଲା। ଦୂରତା ପ୍ରାୟ କେତେ?`,
  'A child runs half way round a circular field of radius 7 m. The distance is about —',
), [
  opt('a', `${OD(halfCircle.displacement)} ମି.`, `${halfCircle.displacement} m`, false, ['distance_is_straight_line']),
  opt('b', `${OD(Math.round(halfCircle.distance))} ମି.`, `${Math.round(halfCircle.distance)} m`, true),
  opt('c', `${OD(7)} ମି.`, '7 m'),
]);
mcq('dist.4', 'distance', 1, u(
  'ଦୂରତାର SI ଏକକ କଣ?',
  'What is the SI unit of distance?',
), [
  opt('a', 'ମିଟର (m)', 'metre (m)', true),
  opt('b', 'ସେକେଣ୍ଡ (s)', 'second (s)'),
  opt('c', 'ମିଟର ପ୍ରତି ସେକେଣ୍ଡ (m/s)', 'metre per second (m/s)', false, ['unit_confusion']),
]);
numeric('dist.5', 'distance', 2, u(
  `ଗୋଟିଏ ଛେଳି ଖୁଣ୍ଟରୁ ପୂର୍ବକୁ ${OD(5)} ମି. ଗଲା, ତା’ପରେ ପଶ୍ଚିମକୁ ${OD(2)} ମି. ଫେରିଲା। ମୋଟ ଦୂରତା କେତେ? (ମିଟରରେ)`,
  'A goat goes 5 m east from its post, then comes back 2 m west. What is the total distance? (in metres)',
), goat.distance, 'length', 'path([[5,0],[-2,0]]).distance');
mcq('dist.6', 'distance', 2, u(
  'ଦୂରତା କେବେ ଶୂନ୍ୟ ହୁଏ?',
  'When is distance zero?',
), [
  opt('a', 'ଯେତେବେଳେ ବସ୍ତୁ ଆଦୌ ଗତି କରେ ନାହିଁ', 'when the object does not move at all', true),
  opt('b', 'ଯେତେବେଳେ ବସ୍ତୁ ଆରମ୍ଭ ସ୍ଥାନକୁ ଫେରିଆସେ', 'when the object comes back to where it started', false, ['distance_equals_displacement'], ['ଫେରିଆସିଲେ ବିସ୍ଥାପନ ଶୂନ୍ୟ ହୁଏ, ଦୂରତା ନୁହେଁ — ଚାଲିଥିବା ସବୁ ବାଟ ଦୂରତାରେ ଗଣାଯାଏ।', 'Coming back makes the displacement zero, not the distance — every step walked counts in distance.']),
  opt('c', 'କେବେ ବି ନୁହେଁ', 'never'),
]);

// ---------- displacement ----------
explain('displacement', 1, 'definition', 3, u(
  'ବିସ୍ଥାପନ (Displacement) ହେଉଛି ଆରମ୍ଭ ସ୍ଥାନରୁ ଶେଷ ସ୍ଥାନ ପର୍ଯ୍ୟନ୍ତ ସିଧା ଦୂରତା, ଦିଗ ସହିତ। ମଝିରେ ବାଟ କେମିତି ଥିଲା, ତାହା ଗଣାଯାଏ ନାହିଁ। ଏଥିରେ ପରିମାଣ ଓ ଦିଗ ଦୁଇଟି ଥାଏ, ତେଣୁ ଏହା ଏକ ସଦିଶ ରାଶି (vector)।',
  'Displacement is the straight-line distance from the starting point to the end point, with direction. The path in between does not count. It has size and direction, so it is a vector.',
  { or: 'ବିସ୍ଥାପନ ହେଉଛି ଆରମ୍ଭ ସ୍ଥାନରୁ ଶେଷ ସ୍ଥାନ ପର୍ଯ୍ୟନ୍ତ ସିଧା ଦୂରତା, ଦିଗ ସହିତ। ମଝିରେ ବାଟ କେମିତି ଥିଲା, ତାହା ଗଣାଯାଏ ନାହିଁ। ଏଥିରେ ପରିମାଣ ଓ ଦିଗ ଦୁଇଟି ଥାଏ, ତେଣୁ ଏହା ଏକ ସଦିଶ ରାଶି।' },
));
explain('displacement', 2, 'analogy', 2, u(
  'ଗୋଟିଏ କୁଆ ଘରୁ ହାଟକୁ ସିଧା ଉଡ଼ିଯାଏ — ତାକୁ ବିଲ ହିଡ଼ ବୁଲିବାକୁ ପଡ଼େନି। କୁଆ ଯେଉଁ ସିଧା ରେଖାରେ ଉଡ଼େ, ତାହାର ଲମ୍ବ ଓ ଦିଗ ହିଁ ବିସ୍ଥାପନ। ତୁମେ ଯେତେ ବୁଲିଲେ ବି, ବିସ୍ଥାପନ କେବଳ ଆରମ୍ଭ ଓ ଶେଷ ସ୍ଥାନ ଉପରେ ନିର୍ଭର କରେ।',
  'A crow flies straight from home to the haat — it does not follow the field bunds. The length and direction of that straight line is the displacement. However much you wander, displacement depends only on where you start and where you end.',
));
explain('displacement', 3, 'contrast', 3, u(
  `ସକାଳେ ତୁମେ ଘରୁ ସ୍କୁଲ ଗଲ (${OD(2)} କି.ମି.), ସଞ୍ଜରେ ଫେରି ଆସିଲ (${OD(2)} କି.ମି.)। ମୋଟ ଦୂରତା = ${OD(roundTripKm.distance)} କି.ମି.। କିନ୍ତୁ ଯେଉଁଠୁ ଆରମ୍ଭ କରିଥିଲ, ସେଇଠି ଶେଷ କଲ — ତେଣୁ ବିସ୍ଥାପନ = ${OD(roundTripKm.displacement)}। ଗତି ହେଲା, ତଥାପି ବିସ୍ଥାପନ ଶୂନ୍ୟ ହୋଇପାରେ।`,
  `In the morning you go from home to school (2 km) and come back in the evening (2 km). Total distance = ${roundTripKm.distance} km. But you ended where you started — so displacement = ${roundTripKm.displacement}. You moved, yet displacement can be zero.`,
  { or: 'ସକାଳେ ତୁମେ ଘରୁ ସ୍କୁଲ ଗଲ, ଦୁଇ କିଲୋମିଟର, ସଞ୍ଜରେ ଫେରି ଆସିଲ, ଦୁଇ କିଲୋମିଟର। ମୋଟ ଦୂରତା ଚାରି କିଲୋମିଟର। କିନ୍ତୁ ଯେଉଁଠୁ ଆରମ୍ଭ କରିଥିଲ, ସେଇଠି ଶେଷ କଲ, ତେଣୁ ବିସ୍ଥାପନ ଶୂନ୍ୟ। ଗତି ହେଲା, ତଥାପି ବିସ୍ଥାପନ ଶୂନ୍ୟ ହୋଇପାରେ।' },
), ['displacement_never_zero', 'distance_equals_displacement']);
explain('displacement', 4, 'worked_example', 3, u(
  `ସୀମା ପୂର୍ବକୁ ${OD(3)} ମି. ଓ ଉତ୍ତରକୁ ${OD(4)} ମି. ଚାଲିଲା। ଦୂରତା = ${OD(walk.distance)} ମି.। ଆରମ୍ଭରୁ ଶେଷ ପର୍ଯ୍ୟନ୍ତ ସିଧା ରେଖା ଗୋଟିଏ ସମକୋଣୀ ତ୍ରିଭୁଜର କର୍ଣ୍ଣ: √(${OD(3)}² + ${OD(4)}²) = ${OD(walk.displacement)} ମି.। ତେଣୁ ବିସ୍ଥାପନ = ${OD(walk.displacement)} ମି., ଉତ୍ତର-ପୂର୍ବ ଦିଗରେ। ବିସ୍ଥାପନ କେବେ ବି ଦୂରତାଠାରୁ ବେଶୀ ହୁଏ ନାହିଁ।`,
  `Seema walks 3 m east and 4 m north. Distance = ${walk.distance} m. The straight line from start to end is the hypotenuse of a right triangle: √(3² + 4²) = ${walk.displacement} m. So displacement = ${walk.displacement} m towards the north-east. Displacement is never more than distance.`,
  { or: 'ସୀମା ପୂର୍ବକୁ ତିନି ମିଟର ଓ ଉତ୍ତରକୁ ଚାରି ମିଟର ଚାଲିଲା। ଦୂରତା ସାତ ମିଟର। ଆରମ୍ଭରୁ ଶେଷ ପର୍ଯ୍ୟନ୍ତ ସିଧା ରେଖା ଗୋଟିଏ ସମକୋଣୀ ତ୍ରିଭୁଜର କର୍ଣ୍ଣ। ତିନିର ବର୍ଗ ଯୁକ୍ତ ଚାରିର ବର୍ଗର ବର୍ଗମୂଳ, ସମାନ ପାଞ୍ଚ ମିଟର। ତେଣୁ ବିସ୍ଥାପନ ପାଞ୍ଚ ମିଟର, ଉତ୍ତର-ପୂର୍ବ ଦିଗରେ। ବିସ୍ଥାପନ କେବେ ବି ଦୂରତାଠାରୁ ବେଶୀ ହୁଏ ନାହିଁ।', en: 'Seema walks three metres east and four metres north. Distance is seven metres. The straight line from start to end is the hypotenuse of a right triangle: the square root of three squared plus four squared, which is five metres. So displacement is five metres towards the north-east. Displacement is never more than distance.' },
), ['distance_equals_displacement', 'displacement_greater_than_distance']);
mcq('disp.1', 'displacement', 1, u(
  `ଗୀତା ଘରୁ ପୋଖରୀ ଗଲା (${OD(300)} ମି.) ଓ ସେହି ବାଟରେ ଘରକୁ ଫେରିଲା। ତା'ର ବିସ୍ଥାପନ କେତେ?`,
  'Gita walks from home to the pond (300 m) and back home the same way. What is her displacement?',
), [
  opt('a', `${OD(600)} ମି.`, '600 m', false, ['distance_equals_displacement'], ['ଏହା ଦୂରତା। ବିସ୍ଥାପନ କେବଳ ଆରମ୍ଭ ଓ ଶେଷ ସ୍ଥାନ ଦେଖେ।', 'That is the distance. Displacement only looks at start and end points.']),
  opt('b', `${OD(300)} ମି.`, '300 m', false, ['displacement_never_zero']),
  opt('c', 'ଶୂନ୍ୟ', 'zero', true),
], true);
mcq('disp.2', 'displacement', 2, u(
  'କେଉଁଟି କେବେ ବି ସମ୍ଭବ ନୁହେଁ?',
  'Which of these can never happen?',
), [
  opt('a', 'ବିସ୍ଥାପନ = ଦୂରତା', 'displacement = distance'),
  opt('b', 'ବିସ୍ଥାପନ > ଦୂରତା', 'displacement > distance', true),
  opt('c', 'ବିସ୍ଥାପନ = ଶୂନ୍ୟ, କିନ୍ତୁ ଦୂରତା ଶୂନ୍ୟ ନୁହେଁ', 'displacement = 0 but distance is not 0', false, ['displacement_never_zero']),
]);
numeric('disp.3', 'displacement', 2, u(
  `ଗୋଟିଏ ପିଲା ପୂର୍ବକୁ ${OD(3)} ମି. ଓ ତା'ପରେ ଉତ୍ତରକୁ ${OD(4)} ମି. ଗଲା। ବିସ୍ଥାପନର ପରିମାଣ କେତେ? (ମିଟରରେ)`,
  'A child goes 3 m east and then 4 m north. What is the size of the displacement? (in metres)',
), walk.displacement, 'length', 'path([[3,0],[0,4]]).displacement');
mcq('disp.4', 'displacement', 2, u(
  `ଗୋଟିଏ ପିଲା ${OD(7)} ମି. ବ୍ୟାସାର୍ଦ୍ଧର ବୃତ୍ତାକାର ପଡ଼ିଆର ଅଧା ବୁଲିଲା। ବିସ୍ଥାପନ କେତେ?`,
  'A child runs half way round a circular field of radius 7 m. What is the displacement?',
), [
  opt('a', `${OD(halfCircle.displacement)} ମି. (ବ୍ୟାସ)`, `${halfCircle.displacement} m (the diameter)`, true),
  opt('b', `${OD(Math.round(halfCircle.distance))} ମି.`, `${Math.round(halfCircle.distance)} m`, false, ['distance_equals_displacement']),
  opt('c', 'ଶୂନ୍ୟ', 'zero', false, ['displacement_never_zero']),
]);
mcq('disp.5', 'displacement', 1, u(
  'ବିସ୍ଥାପନ କି ପ୍ରକାର ରାଶି?',
  'What kind of quantity is displacement?',
), [
  opt('a', 'ସଦିଶ (ପରିମାଣ + ଦିଗ)', 'vector (size + direction)', true),
  opt('b', 'ଅଦିଶ (କେବଳ ପରିମାଣ)', 'scalar (size only)', false, ['distance_equals_displacement']),
], true);

// ---------- speed ----------
explain('speed', 1, 'definition', 3, u(
  'ଦ୍ରୁତି (Speed) କହେ ଗୋଟିଏ ବସ୍ତୁ କେତେ ଶୀଘ୍ର ଯାଉଛି — ଏକ ସେକେଣ୍ଡରେ କେତେ ବାଟ ଯାଉଛି। ଦ୍ରୁତି = ଦୂରତା ÷ ସମୟ। ଏକକ: ମିଟର ପ୍ରତି ସେକେଣ୍ଡ (m/s)। ଦ୍ରୁତିରେ ଦିଗ ନଥାଏ — ଏହା ଅଦିଶ ରାଶି।',
  'Speed tells how fast an object is going — how much distance it covers in one second. Speed = distance ÷ time. Unit: metre per second (m/s). Speed has no direction — it is a scalar.',
  { or: 'ଦ୍ରୁତି କହେ ଗୋଟିଏ ବସ୍ତୁ କେତେ ଶୀଘ୍ର ଯାଉଛି, ଏକ ସେକେଣ୍ଡରେ କେତେ ବାଟ ଯାଉଛି। ଦ୍ରୁତି ସମାନ ଦୂରତାକୁ ସମୟ ଦ୍ୱାରା ଭାଗ। ଏହାର ଏକକ ମିଟର ପ୍ରତି ସେକେଣ୍ଡ। ଦ୍ରୁତିରେ ଦିଗ ନଥାଏ, ଏହା ଅଦିଶ ରାଶି।', en: 'Speed tells how fast an object is going, how much distance it covers in one second. Speed equals distance divided by time. Its unit is metres per second. Speed has no direction; it is a scalar.' },
));
explain('speed', 2, 'analogy', 2, u(
  'ତୁମେ ଓ ତୁମ ସାଙ୍ଗ ଦୁହେଁ ସାଇକେଲରେ ୧୦ ମିନିଟ ଚଲାଇଲ। ତୁମେ ହାଟ ପର୍ଯ୍ୟନ୍ତ ପହଞ୍ଚିଲ, ସାଙ୍ଗ ଅଧା ବାଟରେ ରହିଲା। ଏକା ସମୟରେ ଯିଏ ଅଧିକ ବାଟ ଯାଏ, ତା\'ର ଦ୍ରୁତି ବେଶୀ।',
  'You and your friend both cycle for 10 minutes. You reach the haat; your friend is only half way. Whoever covers more distance in the same time has the greater speed.',
));
explain('speed', 3, 'worked_example', 3, u(
  `ଗୋଟିଏ ବସ୍ ${OD(2)} ଘଣ୍ଟାରେ ${OD(90)} କି.ମି. ଗଲା। ଦ୍ରୁତି = ${OD(90)} ÷ ${OD(2)} = ${OD(busSpeed)} କି.ମି./ଘଣ୍ଟା। ମିଟର ପ୍ରତି ସେକେଣ୍ଡରେ: ${OD(busSpeed)} × ${OD(1000)} ÷ ${OD(3600)} = ${OD(busMps)} m/s।`,
  `A bus travels 90 km in 2 hours. Speed = 90 ÷ 2 = ${busSpeed} km/h. In metres per second: ${busSpeed} × 1000 ÷ 3600 = ${busMps} m/s.`,
  { or: 'ଗୋଟିଏ ବସ୍ ଦୁଇ ଘଣ୍ଟାରେ ନବେ କିଲୋମିଟର ଗଲା। ଦ୍ରୁତି ନବେକୁ ଦୁଇରେ ଭାଗ, ସମାନ ପଞ୍ଚଚାଳିଶ କିଲୋମିଟର ପ୍ରତି ଘଣ୍ଟା। ମିଟର ପ୍ରତି ସେକେଣ୍ଡରେ ଏହା ବାର ଦଶମିକ ପାଞ୍ଚ ମିଟର ପ୍ରତି ସେକେଣ୍ଡ।', en: 'A bus travels ninety kilometres in two hours. Speed is ninety divided by two, which is forty-five kilometres per hour. In metres per second that is twelve point five metres per second.' },
));
explain('speed', 4, 'contrast', 4, u(
  `ରାଜୁ ଗାଁରୁ ସହରକୁ ${OD(60)} କି.ମି. ${OD(20)} କି.ମି./ଘଣ୍ଟାରେ ଗଲା ଓ ${OD(30)} କି.ମି./ଘଣ୍ଟାରେ ଫେରିଲା। ହାରାହାରି ଦ୍ରୁତି ${OD(25)} ନୁହେଁ! ଯିବାକୁ ${OD(3)} ଘଣ୍ଟା, ଫେରିବାକୁ ${OD(2)} ଘଣ୍ଟା — ମୋଟ ${OD(tripTime)} ଘଣ୍ଟା। ହାରାହାରି ଦ୍ରୁତି = ମୋଟ ଦୂରତା ÷ ମୋଟ ସମୟ = ${OD(120)} ÷ ${OD(tripTime)} = ${OD(tripAvg)} କି.ମି./ଘଣ୍ଟା।`,
  `Raju goes 60 km from village to town at 20 km/h and returns at 30 km/h. The average speed is NOT 25! Going takes 3 h, returning 2 h — ${tripTime} h in all. Average speed = total distance ÷ total time = 120 ÷ ${tripTime} = ${tripAvg} km/h.`,
), ['average_speed_is_mean']);
mcq('spd.1', 'speed', 1, u(
  'ଦ୍ରୁତିର ସୂତ୍ର କଣ?',
  'What is the formula for speed?',
), [
  opt('a', 'ଦୂରତା ÷ ସମୟ', 'distance ÷ time', true),
  opt('b', 'ସମୟ ÷ ଦୂରତା', 'time ÷ distance'),
  opt('c', 'ଦୂରତା × ସମୟ', 'distance × time'),
], true);
numeric('spd.2', 'speed', 2, u(
  `ମିନୁ ${OD(5)} ମିନିଟରେ (${OD(300)} ସେକେଣ୍ଡ) ସାଇକେଲରେ ${OD(1200)} ମି. ଗଲା। ତା'ର ଦ୍ରୁତି କେତେ m/s?`,
  'Minu cycles 1200 m in 5 minutes (300 s). What is her speed in m/s?',
), cycleSpeed, 'speed', 'average_speed(1200,300)');
mcq('spd.3', 'speed', 3, u(
  `${OD(60)} କି.ମି. ${OD(20)} କି.ମି./ଘଣ୍ଟାରେ ଯାଇ ${OD(30)} କି.ମି./ଘଣ୍ଟାରେ ଫେରିଲେ, ହାରାହାରି ଦ୍ରୁତି କେତେ?`,
  'Going 60 km at 20 km/h and returning at 30 km/h, what is the average speed?',
), [
  opt('a', `${OD(25)} କି.ମି./ଘଣ୍ଟା`, '25 km/h', false, ['average_speed_is_mean'], ['ଦୁଇ ଦ୍ରୁତିର ହାରାହାରି ନୁହେଁ — ମୋଟ ଦୂରତା ÷ ମୋଟ ସମୟ।', 'Not the mean of the two speeds — total distance ÷ total time.']),
  opt('b', `${OD(tripAvg)} କି.ମି./ଘଣ୍ଟା`, `${tripAvg} km/h`, true),
  opt('c', `${OD(50)} କି.ମି./ଘଣ୍ଟା`, '50 km/h'),
]);
numeric('spd.4', 'speed', 2, u(
  `${OD(36)} କି.ମି./ଘଣ୍ଟାକୁ m/s ରେ ଲେଖ।`,
  'Write 36 km/h in m/s.',
), k36, 'speed', 'kmph_to_mps(36)');
mcq('spd.5', 'speed', 1, u(
  'ଦ୍ରୁତିରେ ଦିଗ ଥାଏ କି?',
  'Does speed have a direction?',
), [
  opt('a', 'ହଁ', 'yes', false, ['speed_equals_velocity']),
  opt('b', 'ନା, କେବଳ ପରିମାଣ', 'no, only size', true),
], true);
numeric('spd.6', 'speed', 2, u(
  `ଗୋଟିଏ ପିଲା ${OD(20)} ସେକେଣ୍ଡରେ ${OD(100)} ମି. ଦୌଡ଼ିଲା। ତା’ର ଦ୍ରୁତି କେତେ m/s?`,
  'A child runs 100 m in 20 s. What is her speed in m/s?',
), sprint, 'speed', 'average_speed(100,20)');

// ---------- velocity ----------
explain('velocity', 1, 'definition', 3, u(
  'ବେଗ (Velocity) ହେଉଛି ଦିଗ ସହିତ ଦ୍ରୁତି। ବେଗ = ବିସ୍ଥାପନ ÷ ସମୟ। ଦ୍ରୁତି କେବଳ "କେତେ ଜୋରରେ" କହେ; ବେଗ "କେତେ ଜୋରରେ ଓ କେଉଁ ଦିଗରେ" ଦୁଇଟି କହେ। ତେଣୁ ବେଗ ଏକ ସଦିଶ ରାଶି।',
  'Velocity is speed with a direction. Velocity = displacement ÷ time. Speed only tells "how fast"; velocity tells "how fast and which way". So velocity is a vector.',
  { or: 'ବେଗ ହେଉଛି ଦିଗ ସହିତ ଦ୍ରୁତି। ବେଗ ସମାନ ବିସ୍ଥାପନକୁ ସମୟ ଦ୍ୱାରା ଭାଗ। ଦ୍ରୁତି କେବଳ କେତେ ଜୋରରେ କହେ, ବେଗ କେତେ ଜୋରରେ ଓ କେଉଁ ଦିଗରେ ଦୁଇଟି କହେ। ତେଣୁ ବେଗ ଏକ ସଦିଶ ରାଶି।' },
));
explain('velocity', 2, 'contrast', 2, u(
  `ଭୁବନେଶ୍ୱରରୁ ଦୁଇଟି ବସ୍ ଘଣ୍ଟାକୁ ${OD(40)} କି.ମି. ଦ୍ରୁତିରେ ବାହାରିଲା — ଗୋଟିଏ କଟକ ଆଡ଼କୁ (ଉତ୍ତର), ଆରଟି ପୁରୀ ଆଡ଼କୁ (ଦକ୍ଷିଣ)। ଦ୍ରୁତି ସମାନ, କିନ୍ତୁ ଦିଗ ଅଲଗା — ତେଣୁ ବେଗ ଅଲଗା।`,
  'Two buses leave Bhubaneswar at 40 km/h — one towards Cuttack (north), the other towards Puri (south). Same speed, different direction — so different velocity.',
  { or: 'ଭୁବନେଶ୍ୱରରୁ ଦୁଇଟି ବସ୍ ଘଣ୍ଟାକୁ ଚାଳିଶ କିଲୋମିଟର ଦ୍ରୁତିରେ ବାହାରିଲା। ଗୋଟିଏ କଟକ ଆଡ଼କୁ, ଉତ୍ତର ଦିଗରେ, ଆରଟି ପୁରୀ ଆଡ଼କୁ, ଦକ୍ଷିଣ ଦିଗରେ। ଦ୍ରୁତି ସମାନ, କିନ୍ତୁ ଦିଗ ଅଲଗା, ତେଣୁ ବେଗ ଅଲଗା।', en: 'Two buses leave Bhubaneswar at forty kilometres per hour. One goes towards Cuttack, to the north, the other towards Puri, to the south. Same speed, but different direction, so different velocity.' },
), ['speed_equals_velocity']);
explain('velocity', 3, 'analogy', 2, u(
  'ନଦୀର ସ୍ରୋତ କଥା ଭାବ। ପାଣି କେତେ ଜୋରରେ ବହୁଛି — ସେଇଟା ଦ୍ରୁତି। ପାଣି କେତେ ଜୋରରେ ଓ କେଉଁ ଆଡ଼କୁ (ସମୁଦ୍ର ଆଡ଼କୁ) ବହୁଛି — ସେଇଟା ବେଗ। ଡଙ୍ଗା ଚଳାଇବାକୁ ଦିଗ ଜାଣିବା ଜରୁରୀ, ତେଣୁ ମାଝୀ ବେଗ ଦେଖେ।',
  'Think of a river current. How fast the water flows — that is speed. How fast AND which way it flows (towards the sea) — that is velocity. A boatman needs the direction, so he cares about velocity.',
), ['speed_equals_velocity']);
explain('velocity', 4, 'worked_example', 3, u(
  `ଘରୁ ସ୍କୁଲ ${OD(2)} କି.ମି.। ଯିବା-ଆସିବା ମିଶି ${OD(1)} ଘଣ୍ଟା ଲାଗିଲା। ହାରାହାରି ଦ୍ରୁତି = ${OD(roundTripKm.distance)} କି.ମି. ÷ ${OD(1)} ଘଣ୍ଟା = ${OD(averageSpeed(roundTripKm.distance, 1))} କି.ମି./ଘଣ୍ଟା। ହାରାହାରି ବେଗ = ବିସ୍ଥାପନ ${OD(roundTripKm.displacement)} ÷ ${OD(1)} ଘଣ୍ଟା = ${OD(roundTripVel)}। ଦ୍ରୁତି ଅଛି, କିନ୍ତୁ ବେଗ ଶୂନ୍ୟ!`,
  `Home to school is 2 km. Going and coming back took 1 hour in all. Average speed = ${roundTripKm.distance} km ÷ 1 h = ${averageSpeed(roundTripKm.distance, 1)} km/h. Average velocity = displacement ${roundTripKm.displacement} ÷ 1 h = ${roundTripVel}. There is speed, but the velocity is zero!`,
  { or: 'ଘରୁ ସ୍କୁଲ ଦୁଇ କିଲୋମିଟର। ଯିବା ଆସିବା ମିଶି ଏକ ଘଣ୍ଟା ଲାଗିଲା। ହାରାହାରି ଦ୍ରୁତି ଚାରି କିଲୋମିଟର ପ୍ରତି ଘଣ୍ଟା। କିନ୍ତୁ ବିସ୍ଥାପନ ଶୂନ୍ୟ, ତେଣୁ ହାରାହାରି ବେଗ ଶୂନ୍ୟ। ଦ୍ରୁତି ଅଛି, କିନ୍ତୁ ବେଗ ଶୂନ୍ୟ!' },
), ['speed_equals_velocity']);
mcq('vel.1', 'velocity', 1, u(
  'ଦ୍ରୁତି ଓ ବେଗ ମଧ୍ୟରେ ମୁଖ୍ୟ ପାର୍ଥକ୍ୟ କଣ?',
  'What is the main difference between speed and velocity?',
), [
  opt('a', 'କିଛି ପାର୍ଥକ୍ୟ ନାହିଁ', 'There is no difference', false, ['speed_equals_velocity'], ['ଦୁଇଟି ଏକା ଲାଗେ, କିନ୍ତୁ ବେଗରେ ଦିଗ ଥାଏ।', 'They sound alike, but velocity has a direction.']),
  opt('b', 'ବେଗରେ ଦିଗ ଥାଏ, ଦ୍ରୁତିରେ ନଥାଏ', 'Velocity has direction, speed does not', true),
  opt('c', 'ବେଗ ସବୁବେଳେ ଦ୍ରୁତିଠାରୁ ବେଶୀ', 'Velocity is always more than speed', false, ['velocity_bigger_than_speed']),
], true);
mcq('vel.2', 'velocity', 2, u(
  `ଦୁଇଟି ସାଇକେଲ ${OD(5)} m/s ରେ ଚାଲୁଛି — ଗୋଟିଏ ପୂର୍ବକୁ, ଆରଟି ପଶ୍ଚିମକୁ। ସେମାନଙ୍କ ବେଗ —`,
  'Two bicycles move at 5 m/s — one east, one west. Their velocities are —',
), [
  opt('a', 'ସମାନ', 'equal', false, ['speed_equals_velocity']),
  opt('b', 'ଅଲଗା, କାରଣ ଦିଗ ଅଲଗା', 'different, because the directions differ', true),
  opt('c', 'ଦୁଇଟି ଶୂନ୍ୟ', 'both zero'),
]);
mcq('vel.3', 'velocity', 2, u(
  'ଗୋଟିଏ ପିଲା ବୃତ୍ତାକାର ପଡ଼ିଆରେ ଠିକ୍ ପୂରା ଗୋଟିଏ ପାକ ଦୌଡ଼ି ଯେଉଁଠୁ ଆରମ୍ଭ କରିଥିଲା ସେଇଠି ଅଟକିଲା। ତା\'ର ହାରାହାରି ବେଗ —',
  'A child runs exactly one full round of a circular field and stops where she started. Her average velocity is —',
), [
  opt('a', 'ଶୂନ୍ୟ', 'zero', true),
  opt('b', 'ତା\'ର ହାରାହାରି ଦ୍ରୁତି ସହ ସମାନ', 'equal to her average speed', false, ['speed_equals_velocity']),
  opt('c', 'କହିହେବ ନାହିଁ', 'cannot be found'),
]);
mcq('vel.4', 'velocity', 3, u(
  'ଗୋଟିଏ ଗାଡ଼ି ବୃତ୍ତାକାର ରାସ୍ତାରେ ସମାନ ଦ୍ରୁତିରେ ଚାଲୁଛି। ତା\'ର ବେଗ —',
  'A car moves round a circular track at constant speed. Its velocity —',
), [
  opt('a', 'ସ୍ଥିର ରହେ', 'stays constant', false, ['constant_speed_means_constant_velocity']),
  opt('b', 'ବଦଳୁଛି, କାରଣ ଦିଗ ବଦଳୁଛି', 'keeps changing, because the direction changes', true),
  opt('c', 'ଶୂନ୍ୟ', 'is zero'),
]);
mcq('vel.5', 'velocity', 1, u(
  'ବେଗର ସୂତ୍ର କଣ?',
  'What is the formula for velocity?',
), [
  opt('a', 'ଦୂରତା ÷ ସମୟ', 'distance ÷ time', false, ['speed_equals_velocity']),
  opt('b', 'ବିସ୍ଥାପନ ÷ ସମୟ', 'displacement ÷ time', true),
  opt('c', 'ସମୟ ÷ ବିସ୍ଥାପନ', 'time ÷ displacement'),
], true);

written('velocity.own_words', 'velocity',
  u('ନିଜ ଭାଷାରେ ଲେଖ: ବେଗ (Velocity) ଦ୍ରୁତି (Speed) ଠାରୁ କିପରି ଅଲଗା?', 'In your own words: how is velocity different from speed?'),
  [{ or: 'ଦିଗ', en: 'direction', romanized: 'diga', hi: 'दिशा' }, { or: 'ଦ୍ରୁତି', en: 'speed', romanized: 'druti', hi: 'चाल' }],
  ['ବେଗ ହେଉଛି ଦିଗ ସହିତ ଦ୍ରୁତି।', 'Velocity is speed with a direction.']);
written('displacement.own_words', 'displacement',
  u('ନିଜ ଭାଷାରେ ଦୁଇ ଧାଡ଼ିରେ ଲେଖ: ବିସ୍ଥାପନ (Displacement) କହିଲେ କ’ଣ ବୁଝାଏ?', 'In your own words: what is displacement?'),
  [{ or: 'ସିଧା', en: 'straight', romanized: 'sidha', hi: 'सीधी' }, { or: 'ଆରମ୍ଭ', en: 'start', romanized: 'arambha', hi: 'शुरू' }],
  ['ଆରମ୍ଭ ସ୍ଥାନରୁ ଶେଷ ସ୍ଥାନ ପର୍ଯ୍ୟନ୍ତ ସିଧା ଦୂରତା, ଦିଗ ସହିତ।', 'The straight-line distance from the start point to the end point, with direction.']);

// ---------- local analogies by region (P3.22) ----------
local('speed', 10, 'coastal',
  'ଦ୍ରୁତି (Speed) ମାନେ କେତେ ଜୋରରେ। ଦୁଇଟି ଡଙ୍ଗା ସମାନ ସମୟରେ ଘାଟରୁ ବାହାରିଲେ, ଯେଉଁ ଡଙ୍ଗା ଆଗରୁ ଜାଲ ପକାଇବା ଜାଗାରେ ପହଞ୍ଚେ, ତା’ର ଦ୍ରୁତି ବେଶୀ।',
  'Speed (ଦ୍ରୁତି) means how fast. Two boats leave the ghat together; the one that reaches the fishing spot first has the higher speed.');
local('speed', 11, 'western',
  'ଦ୍ରୁତି (Speed) ମାନେ କେତେ ଜୋରରେ। ହାଟକୁ ଗୋଟିଏ ଗଡ଼ି ଓ ଗୋଟିଏ ସାଇକେଲ ଏକାଠି ବାହାରିଲେ, ସାଇକେଲ ଆଗରୁ ପହଞ୍ଚେ — ସାଇକେଲର ଦ୍ରୁତି ବେଶୀ।',
  'Speed (ଦ୍ରୁତି) means how fast. A bullock cart and a bicycle leave for the haat together; the bicycle gets there first — it has the higher speed.');
local('speed', 12, 'southern_hills',
  'ଦ୍ରୁତି (Speed) ମାନେ କେତେ ଜୋରରେ। ପାହାଡ଼ ରାସ୍ତାରେ ହାଟକୁ ଚାଲିକି ଗଲେ ବେଶୀ ସମୟ ଲାଗେ, ଜିପ୍‌ରେ ଗଲେ କମ୍ — ଜିପ୍‌ର ଦ୍ରୁତି ବେଶୀ।',
  'Speed (ଦ୍ରୁତି) means how fast. Walking the hill road to the haat takes long; going by jeep takes less time — the jeep has the higher speed.');
local('velocity', 10, 'coastal',
  'ବେଗ (Velocity) ମାନେ କେତେ ଜୋରରେ ଓ କେଉଁ ଦିଗରେ। ନଦୀ ସ୍ରୋତ ସହ ଯାଉଥିବା ଡଙ୍ଗା ଓ ସ୍ରୋତ ବିପରୀତ ଯାଉଥିବା ଡଙ୍ଗା ସମାନ ଜୋରରେ ଗଲେ ବି, ଦିଗ ଅଲଗା ବୋଲି ସେମାନଙ୍କ ବେଗ ଅଲଗା।',
  'Velocity (ବେଗ) means how fast and in which direction. A boat going with the river current and one going against it may be equally fast, but their directions differ, so their velocities differ.');
local('velocity', 11, 'western',
  'ବେଗ (Velocity) ମାନେ କେତେ ଜୋରରେ ଓ କେଉଁ ଦିଗରେ। କେନାଲ ପାଣି ଧାନ କ୍ଷେତ ଆଡ଼କୁ ବହେ — ତା’ର ଦିଗ ଅଛି। ସମାନ ଜୋରରେ ବିପରୀତ ଦିଗରେ ବହିଲେ ବେଗ ଅଲଗା ହୁଏ।',
  'Velocity (ବେଗ) means how fast and in which direction. Canal water flows towards the paddy fields — it has a direction. Flowing equally fast the other way would be a different velocity.');
local('velocity', 12, 'southern_hills',
  'ବେଗ (Velocity) ମାନେ କେତେ ଜୋରରେ ଓ କେଉଁ ଦିଗରେ। ପାହାଡ଼ରୁ ତଳକୁ ବହୁଥିବା ଝରଣା ଓ ତଳୁ ଉପରକୁ ଚଢ଼ୁଥିବା ଲୋକ — ଦୁହିଁଙ୍କ ଦିଗ ଅଲଗା, ତେଣୁ ବେଗ ଅଲଗା।',
  'Velocity (ବେଗ) means how fast and in which direction. A stream running down the hill and a person climbing up — their directions differ, so their velocities differ.');

// ---------- acceleration (C.3: four strategies, checks, misconceptions — draft for native review) ----------
explain('acceleration', 1, 'definition', 3, u(
  'ତ୍ୱରଣ (Acceleration) ହେଉଛି ବେଗ କେତେ ଶୀଘ୍ର ବଦଳୁଛି। ତ୍ୱରଣ = (ଶେଷ ବେଗ − ଆରମ୍ଭ ବେଗ) ÷ ସମୟ। ଏକକ: m/s²। ବେଗ କମିଲେ ତ୍ୱରଣ ଋଣାତ୍ମକ ହୁଏ।',
  'Acceleration is how quickly velocity changes. Acceleration = (final velocity − initial velocity) ÷ time. Unit: m/s². If velocity decreases, the acceleration is negative.',
  { or: 'ତ୍ୱରଣ ହେଉଛି ବେଗ କେତେ ଶୀଘ୍ର ବଦଳୁଛି। ତ୍ୱରଣ ସମାନ ଶେଷ ବେଗ ବିୟୋଗ ଆରମ୍ଭ ବେଗ, ସମୟ ଦ୍ୱାରା ଭାଗ। ଏହାର ଏକକ ମିଟର ପ୍ରତି ବର୍ଗ ସେକେଣ୍ଡ। ବେଗ କମିଲେ ତ୍ୱରଣ ଋଣାତ୍ମକ ହୁଏ।', en: 'Acceleration is how quickly velocity changes. Acceleration equals final velocity minus initial velocity, divided by time. Its unit is metres per second squared. If velocity decreases, the acceleration is negative.' },
));
explain('acceleration', 2, 'analogy', 2, u(
  'ବସ୍ ଷ୍ଟାଣ୍ଡରୁ ବସ୍ ବାହାରିଲା ବେଳେ ଧୀରେ ଧୀରେ ଜୋର ହୁଏ — ତା\'ର ବେଗ ବଢ଼ୁଛି, ଏହା ତ୍ୱରଣ (Acceleration)। ଷ୍ଟପ୍ ପାଖରେ ବ୍ରେକ୍ ମାରିଲେ ବେଗ କମେ — ଏହା ବି ତ୍ୱରଣ, କିନ୍ତୁ ଋଣାତ୍ମକ।',
  'When a bus leaves the bus stand it gets faster little by little — its velocity is increasing: that is acceleration. When it brakes near a stop, its velocity drops — that is also acceleration, but negative.',
), ['acceleration_means_fast']);
explain('acceleration', 3, 'worked_example', 3, u(
  `ଗୋଟିଏ ବସ୍ ସ୍ଥିର ଅବସ୍ଥାରୁ ${OD(5)} ସେକେଣ୍ଡରେ ${OD(20)} m/s ବେଗ ପାଏ। ତ୍ୱରଣ = (${OD(20)} − ${OD(0)}) ÷ ${OD(5)} = ${OD(busStart)} m/s²। ଅର୍ଥାତ୍ ପ୍ରତି ସେକେଣ୍ଡରେ ବେଗ ${OD(busStart)} m/s ବଢ଼େ।`,
  `A bus starts from rest and reaches 20 m/s in 5 seconds. Acceleration = (20 − 0) ÷ 5 = ${busStart} m/s². So its velocity grows by ${busStart} m/s every second.`,
  { or: `ଗୋଟିଏ ବସ୍ ସ୍ଥିର ଅବସ୍ଥାରୁ ପାଞ୍ଚ ସେକେଣ୍ଡରେ କୋଡ଼ିଏ ମିଟର ପ୍ରତି ସେକେଣ୍ଡ ବେଗ ପାଏ। ତ୍ୱରଣ ସମାନ କୋଡ଼ିଏ ବିୟୋଗ ଶୂନ୍ୟ, ପାଞ୍ଚ ଦ୍ୱାରା ଭାଗ, ଅର୍ଥାତ୍ ଚାରି ମିଟର ପ୍ରତି ବର୍ଗ ସେକେଣ୍ଡ। ପ୍ରତି ସେକେଣ୍ଡରେ ବେଗ ଚାରି ମିଟର ପ୍ରତି ସେକେଣ୍ଡ ବଢ଼େ।`, en: `A bus starts from rest and reaches twenty metres per second in five seconds. Acceleration equals twenty minus zero, divided by five, which is four metres per second squared. Its velocity grows by four metres per second every second.` },
));
explain('acceleration', 4, 'contrast', 3, u(
  'ଜୋରରେ ଯିବା ଓ ଜୋର ହେବା ଅଲଗା। ଏକ୍ସପ୍ରେସ ଟ୍ରେନ୍ ସମାନ ବେଗରେ ଅତି ଜୋରରେ ଗଲେ ତା\'ର ତ୍ୱରଣ (Acceleration) ଶୂନ୍ୟ। ଧୀରେ ଚାଲୁଥିବା ସାଇକେଲ ଜୋର ହେଉଥିଲେ ତା\'ର ତ୍ୱରଣ ଅଛି। ତ୍ୱରଣ ବେଗର ବଦଳ ମାପେ, ବେଗ ନୁହେଁ।',
  'Going fast and getting faster are different. An express train going very fast at a steady velocity has zero acceleration. A slow bicycle that is speeding up has acceleration. Acceleration measures the change in velocity, not the velocity.',
), ['acceleration_means_fast']);
explain('acceleration', 5, 'story', 2, u(
  'ଲିପି ସାଇକେଲରେ ସ୍କୁଲ ଯାଉଥିଲା। ସାମ୍ନାରେ ଛେଳି ଦେଖି ବ୍ରେକ୍ ମାରିଲା — ସାଇକେଲ ଆଗକୁ ଯାଉଥିଲା, କିନ୍ତୁ ବେଗ କମୁଥିଲା। ଏହା ଋଣାତ୍ମକ ତ୍ୱରଣ (Acceleration)। ଋଣାତ୍ମକ ମାନେ ପଛକୁ ଯିବା ନୁହେଁ, ବେଗ କମିବା।',
  'Lipi was cycling to school. She saw a goat ahead and braked — the bicycle kept moving forward, but its velocity was dropping. That is negative acceleration. Negative does not mean going backwards; it means slowing down.',
), ['negative_acceleration_means_backwards']);

mcq('acc.1', 'acceleration', 1, u('ତ୍ୱରଣ (Acceleration) କହିଲେ କ’ଣ ମପାଯାଏ? ଠିକ୍ ଉତ୍ତରଟି ବାଛ।', 'What does acceleration measure?'), [
  opt('a', 'ବେଗ କେତେ ଶୀଘ୍ର ବଦଳୁଛି', 'how quickly velocity changes', true),
  opt('b', 'ବସ୍ତୁ କେତେ ଜୋରରେ ଯାଉଛି', 'how fast an object is going', false, ['acceleration_means_fast']),
  opt('c', 'ମୋଟ କେତେ ବାଟ ଗଲା', 'how much ground was covered'),
], true); // placement item for the top of the graph (C.6)
mcq('acc.2', 'acceleration', 2, u(
  `ଏକ୍ସପ୍ରେସ ଟ୍ରେନ୍ ସମାନ ${OD(30)} m/s ବେଗରେ ସିଧା ରେଳଲାଇନରେ ଯାଉଛି। ତା\'ର ତ୍ୱରଣ —`,
  'An express train runs at a steady 30 m/s on a straight track. Its acceleration is —',
), [
  opt('a', 'ଶୂନ୍ୟ', 'zero', true),
  opt('b', 'ବହୁତ ବେଶୀ, କାରଣ ଟ୍ରେନ୍ ଜୋରରେ ଯାଉଛି', 'very large, because the train is fast', false, ['acceleration_means_fast']),
  opt('c', 'ଋଣାତ୍ମକ', 'negative'),
]);
mcq('acc.3', 'acceleration', 2, u(
  'ସାଇକେଲ ଆଗକୁ ଯାଉଛି କିନ୍ତୁ ବ୍ରେକ୍ ମାରିବାରୁ ବେଗ କମୁଛି। ତା\'ର ତ୍ୱରଣ —',
  'A bicycle is moving forward but slowing down after braking. Its acceleration is —',
), [
  opt('a', 'ଋଣାତ୍ମକ, କାରଣ ବେଗ କମୁଛି', 'negative, because its velocity is decreasing', true),
  opt('b', 'ଋଣାତ୍ମକ, କାରଣ ସାଇକେଲ ପଛକୁ ଯାଉଛି', 'negative, because the bicycle is going backwards', false, ['negative_acceleration_means_backwards']),
  opt('c', 'ଶୂନ୍ୟ, କାରଣ ସାଇକେଲ ଚାଲୁଛି', 'zero, because the bicycle is still moving'),
]);
mcq('acc.4', 'acceleration', 1, u('ତ୍ୱରଣର SI ଏକକ କଣ?', 'What is the SI unit of acceleration?'), [
  opt('a', 'ମିଟର ପ୍ରତି ସେକେଣ୍ଡ (m/s)', 'metre per second (m/s)', false, ['acceleration_means_fast']),
  opt('b', 'ମିଟର ପ୍ରତି ବର୍ଗ ସେକେଣ୍ଡ (m/s²)', 'metre per second squared (m/s²)', true),
  opt('c', 'ମିଟର (m)', 'metre (m)'),
], true); // second placement item: a slip on acceleration can be confirmed (C.6)
numeric('acc.5', 'acceleration', 2, u(
  `ଗୋଟିଏ ବସ୍ ସ୍ଥିର ଅବସ୍ଥାରୁ ${OD(5)} ସେକେଣ୍ଡରେ ${OD(20)} m/s ବେଗ ପାଏ। ତ୍ୱରଣ କେତେ? (m/s² ରେ)`,
  'A bus starts from rest and reaches 20 m/s in 5 s. What is its acceleration? (in m/s²)',
), busStart, 'acceleration', 'suvat(u=0,v=20,t=5).a');
numeric('acc.6', 'acceleration', 3, u(
  `ଗୋଟିଏ ସାଇକେଲ ${OD(10)} m/s ରୁ ବ୍ରେକ୍ ମାରି ${OD(5)} ସେକେଣ୍ଡରେ ଅଟକିଲା। ତ୍ୱରଣ କେତେ? (m/s² ରେ)`,
  'A bicycle going at 10 m/s brakes and stops in 5 s. What is its acceleration? (in m/s²)',
), cycleBrake, 'acceleration', 'suvat(u=10,v=0,t=5).a');
numeric('acc.7', 'acceleration', 2, u(
  `ଗୋଟିଏ ଟ୍ରେନ୍‌ର ବେଗ ${OD(4)} ସେକେଣ୍ଡରେ ${OD(5)} m/s ରୁ ${OD(15)} m/s ହେଲା। ତ୍ୱରଣ କେତେ? (m/s² ରେ)`,
  'A train speeds up from 5 m/s to 15 m/s in 4 s. What is its acceleration? (in m/s²)',
), trainUp, 'acceleration', 'suvat(u=5,v=15,t=4).a');

export const motionPack: ChapterPack = {
  id: 'cbse9-sci-motion',
  version: 1,
  subject: 'science',
  classLevel: 9,
  board: 'BSE-Odisha',
  title: { or: 'ଗତି', en: 'Motion' },
  languages: ['or', 'en'],
  graph: {
    concepts: {
      reference_point: { id: 'reference_point', name: { or: 'ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ', en: 'Reference point', hi: 'निर्देश बिंदु' }, prerequisites: [], weight: 0.6, depth: 'core' },
      distance: { id: 'distance', name: { or: 'ଦୂରତା', en: 'Distance', hi: 'दूरी' }, prerequisites: ['reference_point'], weight: 0.8, depth: 'core' },
      displacement: { id: 'displacement', name: { or: 'ବିସ୍ଥାପନ', en: 'Displacement', hi: 'विस्थापन' }, prerequisites: ['distance'], weight: 1, depth: 'core' },
      speed: { id: 'speed', name: { or: 'ଦ୍ରୁତି', en: 'Speed', hi: 'चाल' }, prerequisites: ['distance'], weight: 1, depth: 'core' },
      velocity: { id: 'velocity', name: { or: 'ବେଗ', en: 'Velocity', hi: 'वेग' }, prerequisites: ['speed', 'displacement'], weight: 1, depth: 'core' },
      acceleration: { id: 'acceleration', name: { or: 'ତ୍ୱରଣ', en: 'Acceleration', hi: 'त्वरण' }, prerequisites: ['velocity'], weight: 1, depth: 'core' },
    },
  },
  explanations: exp,
  checks,
  glossary: [
    { conceptId: 'reference_point', term: { or: 'ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ', en: 'reference point', hi: 'निर्देश बिंदु' }, english: 'reference point', everyday: { or: 'ଯାହା ସହ ତୁଳନା କରି ମାପୁ', en: 'the place we measure from', hi: 'जहाँ से हम नापते हैं' }, romanized: ['nirdesha bindu', 'nirdesh bindu', 'nirdesa bindu'] },
    { conceptId: 'distance', term: { or: 'ଦୂରତା', en: 'distance', hi: 'दूरी' }, english: 'distance', everyday: { or: 'ମୋଟ କେତେ ବାଟ ଗଲା', en: 'how much ground was covered', hi: 'कुल कितना रास्ता तय किया' }, romanized: ['durata', 'durota', 'doorata', 'dürata', 'doori', 'duri'], avoid: { or: ['ତିର୍ୟକ ଦୂରତା'] } },
    { conceptId: 'displacement', term: { or: 'ବିସ୍ଥାପନ', en: 'displacement', hi: 'विस्थापन' }, english: 'displacement', everyday: { or: 'ଆରମ୍ଭରୁ ଶେଷ ପର୍ଯ୍ୟନ୍ତ ସିଧା ରେଖା', en: 'straight line from start to end', hi: 'शुरू से अंत तक सीधी रेखा' }, romanized: ['bisthapana', 'bisthapan', 'visthapan', 'bistapana', 'bisthapono'] },
    { conceptId: 'speed', term: { or: 'ଦ୍ରୁତି', en: 'speed', hi: 'चाल' }, english: 'speed', everyday: { or: 'କେତେ ଜୋରରେ', en: 'how fast', hi: 'कितनी तेज़' }, romanized: ['druti', 'drutti', 'droti', 'druti o', 'chal', 'chaal'], avoid: { or: ['ଗତିବେଗ', 'ଗତିଭେଗ'] } },
    { conceptId: 'velocity', term: { or: 'ବେଗ', en: 'velocity', hi: 'वेग' }, english: 'velocity', everyday: { or: 'କେଉଁ ଦିଗରେ କେତେ ଜୋରରେ', en: 'how fast and which way', hi: 'कितनी तेज़ और किस दिशा में' }, romanized: ['bega', 'bego', 'beg', 'vega', 'veg'], avoid: { or: ['ଗତିବେଗ', 'ଗତିଭେଗ', 'ଭେଗ'] } },
    { conceptId: 'acceleration', term: { or: 'ତ୍ୱରଣ', en: 'acceleration', hi: 'त्वरण' }, english: 'acceleration', everyday: { or: 'ବେଗ କେତେ ଶୀଘ୍ର ବଦଳୁଛି', en: 'how quickly velocity changes', hi: 'वेग कितनी जल्दी बदलता है' }, romanized: ['twarana', 'tvarana', 'twaran'] },
  ],
  misconceptions: [
    { id: 'acceleration_means_fast', conceptId: 'acceleration', description: { or: 'ଜୋରରେ ଯାଉଥିବା ବସ୍ତୁର ତ୍ୱରଣ ବେଶୀ ବୋଲି ଭାବିବା', en: 'Thinks a fast-moving object has a large acceleration' }, severity: 0.8, remediation: ['contrast', 'analogy'] },
    { id: 'negative_acceleration_means_backwards', conceptId: 'acceleration', description: { or: 'ଋଣାତ୍ମକ ତ୍ୱରଣ ମାନେ ପଛକୁ ଯିବା ବୋଲି ଭାବିବା', en: 'Thinks negative acceleration means moving backwards' }, severity: 0.7, remediation: ['story', 'worked_example'] },
    { id: 'motion_is_absolute', conceptId: 'reference_point', description: { or: 'ଗତି ପାଇଁ ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ ଦରକାର ନାହିଁ ବୋଲି ଭାବିବା', en: 'Thinks motion does not depend on a reference point' }, severity: 0.6, remediation: ['analogy'] },
    { id: 'distance_has_direction', conceptId: 'distance', description: { or: 'ଦୂରତାରେ ଦିଗ ଥାଏ ବୋଲି ଭାବିବା', en: 'Thinks distance has a direction' }, severity: 0.6, remediation: ['definition', 'story'] },
    { id: 'distance_is_straight_line', conceptId: 'distance', description: { or: 'ଦୂରତା କେବଳ ସିଧା ରେଖାରେ ମପାଯାଏ ବୋଲି ଭାବିବା', en: 'Thinks distance is the straight-line gap' }, severity: 0.8, remediation: ['analogy', 'worked_example'] },
    { id: 'distance_equals_displacement', conceptId: 'displacement', description: { or: 'ଦୂରତା ଓ ବିସ୍ଥାପନ ସବୁବେଳେ ସମାନ ବୋଲି ଭାବିବା', en: 'Thinks distance and displacement are always equal' }, severity: 1, remediation: ['contrast', 'worked_example'] },
    { id: 'displacement_never_zero', conceptId: 'displacement', description: { or: 'ଗତି କଲେ ବିସ୍ଥାପନ ଶୂନ୍ୟ ହୋଇପାରେନି ବୋଲି ଭାବିବା', en: 'Thinks displacement cannot be zero if the object moved' }, severity: 0.9, remediation: ['contrast'] },
    { id: 'displacement_greater_than_distance', conceptId: 'displacement', description: { or: 'ବିସ୍ଥାପନ ଦୂରତାଠାରୁ ବେଶୀ ହୋଇପାରେ ବୋଲି ଭାବିବା', en: 'Thinks displacement can exceed distance' }, severity: 0.7, remediation: ['worked_example'] },
    { id: 'speed_equals_velocity', conceptId: 'velocity', description: { or: 'ଦ୍ରୁତି ଓ ବେଗ ଏକା ଜିନିଷ ବୋଲି ଭାବିବା', en: 'Thinks speed and velocity are the same thing' }, severity: 1, remediation: ['contrast', 'analogy', 'worked_example'] },
    { id: 'velocity_bigger_than_speed', conceptId: 'velocity', description: { or: 'ବେଗ ସବୁବେଳେ ଦ୍ରୁତିଠାରୁ ବଡ଼ ବୋଲି ଭାବିବା', en: 'Thinks velocity is always larger than speed' }, severity: 0.6, remediation: ['worked_example'] },
    { id: 'constant_speed_means_constant_velocity', conceptId: 'velocity', description: { or: 'ସମାନ ଦ୍ରୁତି ମାନେ ସମାନ ବେଗ ବୋଲି ଭାବିବା', en: 'Thinks constant speed means constant velocity' }, severity: 0.8, remediation: ['contrast'] },
    { id: 'average_speed_is_mean', conceptId: 'speed', description: { or: 'ହାରାହାରି ଦ୍ରୁତି = ଦୁଇ ଦ୍ରୁତିର ହାରାହାରି ବୋଲି ଭାବିବା', en: 'Thinks average speed is the mean of the speeds' }, severity: 0.8, remediation: ['contrast'] },
    { id: 'unit_confusion', conceptId: 'distance', description: { or: 'ଏକକ ଗୋଳମାଳ (m, m/s, km/h)', en: 'Mixes up units (m, m/s, km/h)' }, severity: 0.5, remediation: ['worked_example'] },
  ],
  faq: [
    { id: 'faq.what_is_acceleration', conceptId: 'acceleration', keys: ['ତ୍ୱରଣ କଣ', 'ତ୍ୱରଣ କାହାକୁ କହନ୍ତି', 'twarana kana', 'tvarana kana', 'acceleration kana', 'what is acceleration', 'what does acceleration mean', 'त्वरण क्या है', 'acceleration kya hai', 'ଆକ୍ସିଲେରେସନ୍ କଣ'], answer: u(
      'ତ୍ୱରଣ (Acceleration) ମାନେ ବେଗ କେତେ ଶୀଘ୍ର ବଦଳୁଛି। ବସ୍ ଷ୍ଟାଣ୍ଡରୁ ବସ୍ ଧୀରେ ଧୀରେ ଜୋର ହେଲେ ତା’ର ତ୍ୱରଣ ଅଛି। ସମାନ ବେଗରେ ଚାଲୁଥିବା ଟ୍ରେନ୍‌ର ତ୍ୱରଣ ଶୂନ୍ୟ।',
      'Acceleration means how quickly velocity changes. A bus that gets faster little by little after leaving the stand has acceleration. A train moving at a steady velocity has zero acceleration.',
    ) },
    { id: 'faq.negative_acceleration', conceptId: 'acceleration', keys: ['ଋଣାତ୍ମକ ତ୍ୱରଣ', 'runatmaka twarana', 'negative acceleration kana', 'acceleration negative hei paribo', 'what is negative acceleration', 'ऋणात्मक त्वरण', 'negative acceleration kya hai'], answer: u(
      'ବେଗ କମିଲେ ତ୍ୱରଣ (Acceleration) ଋଣାତ୍ମକ ହୁଏ। ବ୍ରେକ୍ ମାରିଲେ ସାଇକେଲ ଆଗକୁ ଯାଉଥିଲେ ବି ତା’ର ତ୍ୱରଣ ଋଣାତ୍ମକ। ଋଣାତ୍ମକ ମାନେ ପଛକୁ ଯିବା ନୁହେଁ।',
      'Acceleration is negative when velocity decreases. A braking bicycle still moving forward has negative acceleration. Negative does not mean going backwards.',
    ) },
    { id: 'faq.speed_vs_velocity', conceptId: 'velocity', keys: [
      'ଦ୍ରୁତି ଓ ବେଗ ମଧ୍ୟରେ ପାର୍ଥକ୍ୟ କଣ', 'ଦ୍ରୁତି ଆଉ ବେଗ ରେ ଫରକ କଣ', 'speed aau velocity re farak kana', 'speed o velocity madhyare parthakya kana',
      'druti o bega madhyare parthakya', 'difference between speed and velocity', 'speed and velocity difference', 'speed velocity farak',
      'चाल और वेग में क्या अंतर है', 'चाल और वेग में अंतर', 'speed aur velocity mein kya antar hai', 'chal aur veg mein antar', 'speed velocity me fark',
    ], answer: u(
      'ଦ୍ରୁତି (Speed) କେବଳ କହେ କେତେ ଜୋରରେ। ବେଗ (Velocity) କହେ କେତେ ଜୋରରେ ଓ କେଉଁ ଦିଗରେ। ଯେପରି, କଟକ ଆଡ଼କୁ ଓ ପୁରୀ ଆଡ଼କୁ ସମାନ ଦ୍ରୁତିରେ ଯାଉଥିବା ଦୁଇଟି ବସ୍‌ର ବେଗ ଅଲଗା।',
      'Speed only tells how fast. Velocity tells how fast and in which direction. Two buses going at the same speed towards Cuttack and towards Puri have different velocities.',
    ) },
    { id: 'faq.distance_vs_displacement', conceptId: 'displacement', keys: [
      'ଦୂରତା ଓ ବିସ୍ଥାପନ ମଧ୍ୟରେ ପାର୍ଥକ୍ୟ କଣ', 'durata o bisthapana madhyare parthakya', 'distance aau displacement re farak kana',
      'difference between distance and displacement', 'distance displacement farak', 'bisthapana kana',
      'दूरी और विस्थापन में क्या अंतर है', 'दूरी और विस्थापन में अंतर', 'distance aur displacement mein antar', 'doori aur visthapan me fark',
    ], answer: u(
      'ଦୂରତା ହେଉଛି ମୋଟ ଯେତିକି ବାଟ ଗଲ। ବିସ୍ଥାପନ ହେଉଛି ଆରମ୍ଭରୁ ଶେଷ ପର୍ଯ୍ୟନ୍ତ ସିଧା ରେଖା, ଦିଗ ସହିତ। ଘରୁ ସ୍କୁଲ ଯାଇ ଫେରିଲେ ଦୂରତା ଅଛି, କିନ୍ତୁ ବିସ୍ଥାପନ ଶୂନ୍ୟ।',
      'Distance is the total path you travelled. Displacement is the straight line from start to end, with direction. Go to school and come back: there is distance, but displacement is zero.',
    ) },
    { id: 'faq.what_is_reference_point', conceptId: 'reference_point', keys: ['ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ କଣ', 'nirdesh bindu kana', 'nirdesha bindu kana', 'reference point kana', 'what is a reference point', 'what is reference point', 'reference point mane kana', 'निर्देश बिंदु क्या है', 'reference point kya hai'], answer: u(
      'ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ (Reference point) ହେଉଛି ସେହି ସ୍ଥିର ସ୍ଥାନ, ଯାହା ସହିତ ତୁଳନା କରି ଆମେ କହୁ କିଛି ଗତି କରୁଛି କି ନାହିଁ। ଯେପରି, ବସ୍ ଭିତରେ ତୁମେ ସାଙ୍ଗ ପାଇଁ ସ୍ଥିର, କିନ୍ତୁ ରାସ୍ତା କଡ଼ର ଗଛ ପାଇଁ ଗତି କରୁଛ।',
      'A reference point is the fixed place we compare with to say whether something is moving. For example, in a bus you are at rest for your friend but moving for a tree by the road.',
    ) },
    { id: 'faq.what_is_distance', conceptId: 'distance', keys: ['ଦୂରତା କଣ', 'durata kana', 'doorata kana', 'distance kana', 'what is distance', 'distance mane kana', 'दूरी क्या है', 'doori kya hai', 'distance kya hai'], answer: u(
      'ଦୂରତା (Distance) ହେଉଛି ଗୋଟିଏ ବସ୍ତୁ ପ୍ରକୃତରେ ଯେତିକି ବାଟ ଚାଲିଛି, ତାହାର ମୋଟ ଲମ୍ବ। ବାଟ ବଙ୍କା ହେଲେ ବି ସବୁ ବାଟ ଯୋଡ଼ାଯାଏ। ଏଥିରେ ଦିଗ ନଥାଏ। ଏକକ: ମିଟର।',
      'Distance is the total length of the path an object actually travels. Even if the path bends, all of it is added. It has no direction. Unit: metre.',
    ) },
    { id: 'faq.what_is_velocity', conceptId: 'velocity', keys: ['ବେଗ କଣ', 'bega kana', 'bega kan', 'velocity kana', 'what is velocity', 'velocity mane kana', 'वेग क्या है', 'veg kya hai', 'velocity kya hai'], answer: u(
      'ବେଗ ହେଉଛି ଦିଗ ସହିତ ଦ୍ରୁତି — କେଉଁ ଦିଗରେ କେତେ ଜୋରରେ। ବେଗ = ବିସ୍ଥାପନ ÷ ସମୟ।',
      'Velocity is speed with direction — how fast and which way. Velocity = displacement ÷ time.',
    ) },
    { id: 'faq.negative_velocity', conceptId: 'velocity', keys: ['ବେଗ ଋଣାତ୍ମକ ହୋଇପାରିବ କି', 'ଭେଲୋସିଟି ନେଗେଟିଭ ହେଇପାରିବ କି', 'ଋଣାତ୍ମକ ବେଗ', 'bega runatmaka hoiparibo ki', 'velocity negative hei paribo ki', 'can velocity be negative', 'negative velocity', 'क्या वेग ऋणात्मक हो सकता है', 'velocity negative ho sakta hai'], answer: u(
      'ହଁ। ବେଗରେ ଦିଗ ଅଛି। ଗୋଟିଏ ଦିଗକୁ ଯୁକ୍ତାତ୍ମକ (+) ଧରିଲେ, ଓଲଟା ଦିଗରେ ଗଲେ ବେଗ ଋଣାତ୍ମକ (−) ହୁଏ। ଦ୍ରୁତି କେବେ ବି ଋଣାତ୍ମକ ହୁଏ ନାହିଁ।',
      'Yes. Velocity has a direction. If one direction is taken as positive (+), going the opposite way gives a negative (−) velocity. Speed is never negative.',
    ) },
    { id: 'faq.what_is_speed', conceptId: 'speed', keys: ['ଦ୍ରୁତି କଣ', 'druti kana', 'speed kana', 'what is speed', 'speed mane kana', 'चाल क्या है', 'chal kya hai', 'speed kya hai'], answer: u(
      'ଦ୍ରୁତି କହେ କେତେ ଜୋରରେ ଯାଉଛି। ଦ୍ରୁତି = ଦୂରତା ÷ ସମୟ।',
      'Speed tells how fast something is going. Speed = distance ÷ time.',
    ) },
    { id: 'faq.avg_speed', conceptId: 'speed', keys: ['ହାରାହାରି ଦ୍ରୁତି', 'harahari druti', 'average speed kemiti', 'average speed', 'how to find average speed', 'औसत चाल', 'ausat chal kaise nikale'], answer: u(
      'ହାରାହାରି ଦ୍ରୁତି = ମୋଟ ଦୂରତା ÷ ମୋଟ ସମୟ। ଦୁଇଟି ଦ୍ରୁତିକୁ ମିଶାଇ ଦୁଇରେ ଭାଗ କରିବା ଭୁଲ।',
      'Average speed = total distance ÷ total time. Adding two speeds and dividing by two is wrong.',
    ) },
  ],
  passages: [
    { id: 'psg.acceleration', conceptId: 'acceleration', text: {
      or: 'ବସ୍ତୁର ବେଗ ବଦଳିବାର ହାରକୁ ତ୍ୱରଣ କୁହାଯାଏ। ତ୍ୱରଣ = (ଶେଷ ବେଗ − ପ୍ରାରମ୍ଭିକ ବେଗ) ÷ ସମୟ। ଏହାର SI ଏକକ m/s²। ବେଗ କମିଲେ ତ୍ୱରଣ ଋଣାତ୍ମକ ହୁଏ।',
      en: 'The rate of change of velocity of an object is called acceleration. Acceleration = (final velocity − initial velocity) ÷ time. Its SI unit is m/s². If velocity decreases, the acceleration is negative.',
    } },
    { id: 'psg.motion.intro', conceptId: 'reference_point', text: {
      or: 'ଆମ ଚାରିପାଖରେ ଅନେକ ବସ୍ତୁ ଗତି କରୁଛନ୍ତି। କୌଣସି ବସ୍ତୁର ଅବସ୍ଥିତି ବର୍ଣ୍ଣନା କରିବା ପାଇଁ ଆମକୁ ଗୋଟିଏ ନିର୍ଦ୍ଦେଶ ବିନ୍ଦୁ ଦରକାର, ଯାହାକୁ ମୂଳବିନ୍ଦୁ କୁହାଯାଏ।',
      en: 'Many objects around us are in motion. To describe the position of an object we need a reference point, called the origin.',
    } },
    { id: 'psg.distance_displacement', conceptId: 'displacement', text: {
      or: 'ବସ୍ତୁ ଅତିକ୍ରମ କରିଥିବା ମୋଟ ପଥର ଦୈର୍ଘ୍ୟକୁ ଦୂରତା କୁହାଯାଏ। ଆରମ୍ଭ ଅବସ୍ଥିତିରୁ ଶେଷ ଅବସ୍ଥିତି ପର୍ଯ୍ୟନ୍ତ ସର୍ବନିମ୍ନ ଦୂରତାକୁ ବିସ୍ଥାପନ କୁହାଯାଏ।',
      en: 'The total length of the path travelled by an object is called distance. The shortest distance from the initial to the final position is called displacement.',
    } },
    { id: 'psg.speed', conceptId: 'speed', text: {
      or: 'ଏକକ ସମୟରେ ବସ୍ତୁ ଅତିକ୍ରମ କରୁଥିବା ଦୂରତାକୁ ଦ୍ରୁତି କୁହାଯାଏ। ଦ୍ରୁତିର SI ଏକକ ମିଟର ପ୍ରତି ସେକେଣ୍ଡ।',
      en: 'The distance travelled by an object in unit time is called its speed. The SI unit of speed is metre per second.',
    } },
    { id: 'psg.velocity', conceptId: 'velocity', text: {
      or: 'ନିର୍ଦ୍ଦିଷ୍ଟ ଦିଗରେ ବସ୍ତୁର ଦ୍ରୁତିକୁ ବେଗ କୁହାଯାଏ। ବେଗ ଏକ ସଦିଶ ରାଶି।',
      en: 'The speed of an object in a definite direction is called its velocity. Velocity is a vector quantity.',
    } },
  ],
};

