// English school words → the Odia words the BSE Odisha books use for them (P8 offline matching). Offline there is no
// model to translate "earthquake" into ଭୂମିକମ୍ପ, so an English question would miss an Odia-only page; this list
// bridges the common ones. Every Odia word here is checked to occur in the books (content/test/lexicon.test.ts) and is
// on the native reader's list (docs/NATIVE_CHECK.md). The books' own "ଓଡ଼ିଆ (English)" glossary adds the rest.

export const LEXICON: Record<string, string[]> = {
  // life science
  blood: ['ରକ୍ତ'], cell: ['କୋଷ', 'ଜୀବକୋଷ'], cells: ['କୋଷ'], tissue: ['ଟିସୁ'], disease: ['ରୋଗ'], diseases: ['ରୋଗ'],
  vaccine: ['ଟୀକା'], vaccination: ['ଟୀକାକରଣ', 'ଟୀକା'], virus: ['ଭୂତାଣୁ'], bacteria: ['ଜୀବାଣୁ'], tuberculosis: ['ଯକ୍ଷ୍ମା'], malaria: ['ମ୍ୟାଲେରିଆ'],
  pollution: ['ପ୍ରଦୂଷଣ'], soil: ['ମୃତ୍ତିକା', 'ମାଟି'], air: ['ବାୟୁ'], water: ['ଜଳ', 'ପାଣି'], fish: ['ମାଛ'], farming: ['ଚାଷ'],
  crop: ['ଫସଲ'], crops: ['ଫସଲ'], pesticide: ['କୀଟନାଶକ'], pesticides: ['କୀଟନାଶକ'], fertilizer: ['ସାର'], fertilizers: ['ସାର'],
  irrigation: ['ଜଳସେଚନ'], protein: ['ପ୍ରୋଟିନ୍', 'ପ୍ରୋଟିନ', 'ପୁଷ୍ଟିସାର'], plant: ['ଉଦ୍ଭିଦ'], plants: ['ଉଦ୍ଭିଦ'], animal: ['ପ୍ରାଣୀ'], animals: ['ପ୍ରାଣୀ'],
  biodiversity: ['ଜୈବ ବିବିଧତା'], health: ['ସ୍ୱାସ୍ଥ୍ୟ'], food: ['ଖାଦ୍ୟ'], milk: ['କ୍ଷୀର'], resources: ['ସମ୍ପଦ'], resource: ['ସମ୍ପଦ'],
  // geography & economics
  monsoon: ['ମୌସୁମୀ ବାୟୁ', 'ମୌସୁମୀ'], weather: ['ପାଣିପାଗ'], rain: ['ବର୍ଷା'], rainfall: ['ବୃଷ୍ଟିପାତ', 'ବର୍ଷା'], climate: ['ଜଳବାୟୁ'], drought: ['ମରୁଡ଼ି'], flood: ['ବନ୍ୟା'], floods: ['ବନ୍ୟା'],
  cyclone: ['ବାତ୍ୟା'], earthquake: ['ଭୂମିକମ୍ପ'], tsunami: ['ସୁନାମି'], river: ['ନଦୀ'], rivers: ['ନଦୀ'], mountain: ['ପର୍ବତ'], mountains: ['ପର୍ବତ'],
  forest: ['ଅରଣ୍ୟ', 'ଜଙ୍ଗଲ'], forests: ['ଅରଣ୍ୟ', 'ଜଙ୍ଗଲ'], vegetation: ['ଉଦ୍ଭିଦ'], wildlife: ['ବନ୍ୟପ୍ରାଣୀ'], population: ['ଜନସଂଖ୍ୟା'],
  growth: ['ବୃଦ୍ଧି'], literacy: ['ସାକ୍ଷରତା'], poverty: ['ଦାରିଦ୍ର୍ୟ'], money: ['ଟଙ୍କା'], bank: ['ବ୍ୟାଙ୍କ'], banks: ['ବ୍ୟାଙ୍କ'], insurance: ['ବୀମା'],
  development: ['ବିକାଶ'], lake: ['ହ୍ରଦ'], india: ['ଭାରତ'], odisha: ['ଓଡ଼ିଶା'], latitude: ['ଅକ୍ଷାଂଶ'], longitude: ['ଦ୍ରାଘିମା'],
  disaster: ['ବିପର୍ଯ୍ୟୟ'], disasters: ['ବିପର୍ଯ୍ୟୟ'], hazard: ['ବିପଦ'], hazards: ['ବିପଦ'],
  // disasters (man-made)
  road: ['ସଡ଼କ'], accident: ['ଦୁର୍ଘଟଣା'], accidents: ['ଦୁର୍ଘଟଣା'], fire: ['ନିଆଁ', 'ଅଗ୍ନି'], gas: ['ଗ୍ୟାସ'], safety: ['ସୁରକ୍ଷା'],
  // physical science
  speed: ['ବେଗ'], velocity: ['ପରିବେଗ'], acceleration: ['ତ୍ୱରଣ'], motion: ['ଗତି'], distance: ['ଦୂରତା'], displacement: ['ବିସ୍ଥାପନ'], time: ['ସମୟ'],
};

/** The Odia words for the English words in a question ("what is an earthquake" → ['ଭୂମିକମ୍ପ']), per English word. */
export function lexiconFor(word: string): string[] {
  const w = word.toLowerCase();
  return LEXICON[w] ?? (w.endsWith('s') ? LEXICON[w.slice(0, -1)] : undefined) ?? [];
}
