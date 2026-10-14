import { motionPack as draft } from './motion.ts';
import { applyReview, applyTranslation, type ReviewDecisions, type Translations } from './review.ts';
import orReview from '../review/or.json' with { type: 'json' };
import hiDraft from '../translations/hi.json' with { type: 'json' };

/**
 * The Motion pack with native-review decisions applied (content/review/<lang>.json, TODO D6), and Hindi drafted by
 * translation (content/translations/hi.json, C.11) — Hindi items stay drafts until a Hindi reviewer passes them.
 */
export const motionPack = applyTranslation(applyReview(draft, 'or', orReview as ReviewDecisions), 'hi', hiDraft as Translations);
export { draft as motionDraft };
export { packFields, applyReview, applyTranslation, type Translations, type ReviewDecision, type ReviewDecisions, type PackField } from './review.ts';
