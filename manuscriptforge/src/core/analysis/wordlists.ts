// English word lists for the language checks. They are deliberately short
// and conservative: a check that cries wolf gets ignored.

export const FILLERS = [
  'very', 'really', 'just', 'quite', 'actually', 'basically', 'literally', 'totally', 'simply', 'somewhat', 'rather', 'pretty much',
  'kind of', 'sort of', 'a bit', 'a little bit', 'in order to', 'the fact that', 'due to the fact that', 'at this point in time',
  'needless to say', 'for all intents and purposes', 'in actual fact', 'as a matter of fact', 'it goes without saying',
];

export const CLICHES = [
  'at the end of the day', 'avoid like the plague', 'beat around the bush', 'better late than never', 'bite the bullet', 'blood ran cold',
  'bolt from the blue', 'break the ice', 'breath of fresh air', 'butterflies in her stomach', 'butterflies in his stomach',
  'calm before the storm', 'chill ran down', 'cold as ice', 'crystal clear', 'cut to the chase', 'dead as a doornail', 'deafening silence',
  'easier said than done', 'every cloud has a silver lining', 'few and far between', 'fit as a fiddle', 'for all intents and purposes',
  'heart skipped a beat', 'heart of gold', 'in the nick of time', 'it was a dark and stormy night', 'last but not least', 'let out a breath',
  'breath she didn\'t know she was holding', 'breath he didn\'t know he was holding', 'light at the end of the tunnel', 'like a ton of bricks',
  'little did she know', 'little did he know', 'little did they know', 'low-hanging fruit', 'needle in a haystack', 'needless to say',
  'only time will tell', 'plenty of fish in the sea', 'read between the lines', 'scared to death', 'shiver ran down', 'sigh of relief',
  'sight for sore eyes', 'sent shivers down', 'the calm before the storm', 'think outside the box', 'time stood still', 'tip of the iceberg',
  'white as a sheet', 'white as a ghost', 'with bated breath', 'writing on the wall', 'at the drop of a hat', 'back to square one',
  'the whole nine yards', 'when all is said and done', 'time will tell', 'game changer', 'paradigm shift', 'move the needle',
  'take it to the next level', 'win-win situation', 'in today\'s fast-paced world', 'since the dawn of time',
];

/** Words ending in -ly that are not adverbs of manner worth flagging. */
export const NOT_ADVERBS = new Set([
  'only', 'early', 'family', 'likely', 'unlikely', 'lovely', 'lonely', 'ugly', 'holy', 'silly', 'belly', 'jelly', 'bully', 'fly', 'reply', 'supply',
  'apply', 'rely', 'ally', 'italy', 'july', 'daily', 'weekly', 'monthly', 'yearly', 'friendly', 'elderly', 'curly', 'hilly', 'chilly', 'woolly',
  'assembly', 'butterfly', 'multiply', 'imply', 'comply', 'anomaly', 'homily', 'lily', 'emily', 'molly', 'polly', 'sally', 'billy', 'kelly', 'holly',
  'really', 'nearly', 'early', 'ghostly', 'deadly', 'costly', 'orderly', 'cowardly', 'heavenly', 'worldly', 'scholarly', 'kindly',
]);

const IRREGULAR_PARTICIPLES =
  'been|born|bought|brought|built|caught|chosen|done|drawn|driven|eaten|fallen|felt|forgotten|found|given|gone|grown|heard|held|hidden|hit|hurt|kept|known|laid|led|left|lost|made|meant|met|paid|put|read|ridden|run|said|seen|sent|set|shaken|shot|shown|shut|sold|spent|spoken|stolen|struck|sung|taken|taught|thrown|told|torn|understood|woken|won|worn|written';

/** Matches a likely passive construction: a form of "to be" followed by a past participle. */
export const PASSIVE = new RegExp(`\\b(?:am|is|are|was|were|be|been|being)\\s+(?:(?:not|never|also|often|always|just|then|soon|still|\\w+ly)\\s+)?(?:\\w{3,}ed|${IRREGULAR_PARTICIPLES})\\b`, 'gi');

/** Adjectives that end in -ed and follow "was" without being passive. */
export const NOT_PASSIVE = new Set(['tired', 'scared', 'excited', 'worried', 'pleased', 'interested', 'bored', 'surprised', 'married', 'ashamed', 'determined', 'supposed', 'used', 'red', 'bed']);

export const PAST_MARKERS = /\b(?:was|were|had|did|said|went|came|saw|took|made|knew|thought|felt|looked|turned|walked|asked|stood|sat|ran|got|told|heard)\b/gi;
export const PRESENT_MARKERS = /\b(?:is|are|has|does|says|goes|comes|sees|takes|makes|knows|thinks|feels|looks|turns|walks|asks|stands|sits|runs|gets|tells|hears)\b/gi;

/** Usual manuscript lengths for children's formats, in words. */
export const CHILDRENS_FORMATS: { name: string; range: [number, number]; ages: string }[] = [
  { name: 'Board book', range: [0, 300], ages: '0 to 3' },
  { name: 'Picture book', range: [300, 1000], ages: '3 to 7' },
  { name: 'Early reader', range: [1000, 3500], ages: '5 to 8' },
  { name: 'Chapter book', range: [4000, 15000], ages: '6 to 10' },
  { name: 'Middle grade novel', range: [20000, 55000], ages: '8 to 12' },
  { name: 'Young adult novel', range: [50000, 90000], ages: '12 and up' },
];

export const CONTRACTION = /\b\w+['’](?:t|s|re|ve|ll|d|m)\b/gi;
