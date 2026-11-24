/**
 * Words the app prints into books ("Chapter", "Contents", "Notes") in each
 * supported language, and helpers for chapter labels.
 */
import { baseLanguage } from '../model/book';
import type { SectionKind } from '../model/book';
import { numberToWords, titleCase, toRoman } from '../util/text';
import { digitSetFor, toDigits, type DigitSet } from '../i18n/languages';

export interface BookStrings {
  chapter: string;
  part: string;
  contents: string;
  notes: string;
  index: string;
  /** "Also by" before the author's name, or a pattern with {name} where the name goes elsewhere. */
  alsoBy: string;
  /** "ISBN 978... (paperback)" */
  formatNames: { paperback: string; hardcover: string; ebook: string; largePrint: string };
  kinds: Partial<Record<SectionKind, string>>;
  copyrightWord: string;
  publishedBy: string;
  firstPublished: string;
  nlaLine: string;
  moralRight: string;
  typesetIn: string;
  edition: string;
  /** Default rights statement for the copyright page. */
  rights?: string;
  /** Default edition statement ("First edition"). */
  firstEdition?: string;
}

const EN: BookStrings = {
  chapter: 'Chapter',
  part: 'Part',
  contents: 'Contents',
  notes: 'Notes',
  index: 'Index',
  alsoBy: 'Also by',
  formatNames: { paperback: 'paperback', hardcover: 'hardcover', ebook: 'ebook', largePrint: 'large print' },
  kinds: {
    toc: 'Contents',
    foreword: 'Foreword',
    preface: 'Preface',
    introduction: 'Introduction',
    prologue: 'Prologue',
    epilogue: 'Epilogue',
    afterword: 'Afterword',
    acknowledgements: 'Acknowledgements',
    'about-author': 'About the Author',
    'also-by': 'Also by the Author',
    'note-to-readers': 'A Note to Readers',
    'reading-group': 'Reading Group Questions',
    endnotes: 'Notes',
    bibliography: 'Bibliography',
    index: 'Index',
    appendix: 'Appendix',
    glossary: 'Glossary',
    dedication: 'Dedication',
    epigraph: 'Epigraph',
  },
  copyrightWord: 'Copyright',
  publishedBy: 'Published by',
  firstPublished: 'First published',
  nlaLine: 'A catalogue record for this book is available from the National Library of Australia.',
  moralRight: 'The moral right of the author has been asserted.',
  typesetIn: 'Typeset in',
  edition: 'edition',
};

const BN: BookStrings = {
  chapter: 'অধ্যায়', // অধ্যায়
  part: 'পর্ব', // পর্ব
  contents: 'সূচিপত্র', // সূচিপত্র
  notes: 'টীকা', // টীকা
  index: 'নির্ঘণ্ট', // নির্ঘণ্ট
  alsoBy: 'একই লেখকের অন্যান্য বই', // একই লেখকের অন্যান্য বই
  formatNames: {
    paperback: 'পেপারব্যাক', // পেপারব্যাক
    hardcover: 'হার্ডকভার', // হার্ডকভার
    ebook: 'ই-বুক', // ই-বুক
    largePrint: 'বড় হরফ', // বড় হরফ
  },
  kinds: {
    toc: 'সূচিপত্র', // সূচিপত্র
    foreword: 'মুখবন্ধ', // মুখবন্ধ
    preface: 'ভূমিকা', // ভূমিকা
    introduction: 'সূচনা', // সূচনা
    prologue: 'পূর্বকথা', // পূর্বকথা
    epilogue: 'শেষকথা', // শেষকথা
    afterword: 'উত্তরকথন', // উত্তরকথন
    acknowledgements: 'কৃতজ্ঞতা স্বীকার', // কৃতজ্ঞতা স্বীকার
    'about-author': 'লেখক পরিচিতি', // লেখক পরিচিতি
    'also-by': 'একই লেখকের অন্যান্য বই',
    'note-to-readers': 'পাঠকের প্রতি', // পাঠকের প্রতি
    'reading-group': 'পাঠচক্রের প্রশ্ন', // পাঠচক্রের প্রশ্ন
    endnotes: 'টীকা',
    bibliography: 'গ্রন্থপঞ্জি', // গ্রন্থপঞ্জি
    index: 'নির্ঘণ্ট',
    appendix: 'পরিশিষ্ট', // পরিশিষ্ট
    glossary: 'শব্দকোষ', // শব্দকোষ
    dedication: 'উৎসর্গ', // উৎসর্গ
  },
  copyrightWord: 'কপিরাইট', // কপিরাইট
  publishedBy: 'প্রকাশক:', // প্রকাশক:
  firstPublished: 'প্রথম প্রকাশ', // প্রথম প্রকাশ
  nlaLine: 'A catalogue record for this book is available from the National Library of Australia.',
  moralRight: '',
  typesetIn: '',
  edition: 'সংস্করণ', // সংস্করণ
};

const kinds = (k: Record<string, string>): Partial<Record<SectionKind, string>> => k as Partial<Record<SectionKind, string>>;

const FR: BookStrings = {
  chapter: 'Chapitre', part: 'Partie', contents: 'Table des matières', notes: 'Notes', index: 'Index', alsoBy: 'Du même auteur :',
  formatNames: { paperback: 'broché', hardcover: 'relié', ebook: 'livre numérique', largePrint: 'gros caractères' },
  kinds: kinds({
    toc: 'Table des matières', foreword: 'Préface', preface: 'Avant-propos', introduction: 'Introduction', prologue: 'Prologue',
    epilogue: 'Épilogue', afterword: 'Postface', acknowledgements: 'Remerciements', 'about-author': 'À propos de l\u2019auteur',
    'also-by': 'Du même auteur', 'note-to-readers': 'Note au lecteur', 'reading-group': 'Questions pour les clubs de lecture',
    endnotes: 'Notes', bibliography: 'Bibliographie', index: 'Index', appendix: 'Annexe', glossary: 'Glossaire', dedication: 'Dédicace', epigraph: 'Épigraphe',
  }),
  copyrightWord: 'Copyright', publishedBy: 'Publié par', firstPublished: 'Première publication',
  nlaLine: 'Une notice catalographique de ce livre est disponible auprès de la Bibliothèque nationale d\u2019Australie.',
  moralRight: 'Le droit moral de l\u2019auteur a été revendiqué.', typesetIn: 'Composé en', edition: 'édition',
  rights: 'Tous droits réservés. Aucune partie de cette publication ne peut être reproduite, stockée dans un système de recherche documentaire ou transmise sous quelque forme ou par quelque moyen que ce soit, électronique, mécanique, photocopie, enregistrement ou autre, sans l\u2019autorisation écrite préalable de l\u2019éditeur, sauf pour de brèves citations dans des critiques.',
  firstEdition: 'Première édition',
};

const ES: BookStrings = {
  chapter: 'Capítulo', part: 'Parte', contents: 'Índice', notes: 'Notas', index: 'Índice analítico', alsoBy: 'Otros libros de',
  formatNames: { paperback: 'tapa blanda', hardcover: 'tapa dura', ebook: 'libro electrónico', largePrint: 'letra grande' },
  kinds: kinds({
    toc: 'Índice', foreword: 'Prólogo', preface: 'Prefacio', introduction: 'Introducción', prologue: 'Prólogo', epilogue: 'Epílogo',
    afterword: 'Posfacio', acknowledgements: 'Agradecimientos', 'about-author': 'Sobre el autor', 'also-by': 'Otros libros del autor',
    'note-to-readers': 'Nota para los lectores', 'reading-group': 'Preguntas para clubes de lectura', endnotes: 'Notas',
    bibliography: 'Bibliografía', index: 'Índice analítico', appendix: 'Apéndice', glossary: 'Glosario', dedication: 'Dedicatoria', epigraph: 'Epígrafe',
  }),
  copyrightWord: 'Copyright', publishedBy: 'Publicado por', firstPublished: 'Primera edición',
  nlaLine: 'El registro de catálogo de este libro está disponible en la Biblioteca Nacional de Australia.',
  moralRight: 'Se ha hecho valer el derecho moral del autor.', typesetIn: 'Compuesto en', edition: 'edición',
  rights: 'Reservados todos los derechos. Ninguna parte de esta publicación puede ser reproducida, almacenada en un sistema de recuperación ni transmitida de ninguna forma ni por ningún medio, electrónico, mecánico, fotocopia, grabación u otro, sin la autorización previa por escrito del editor, salvo breves citas en reseñas.',
  firstEdition: 'Primera edición',
};

const DE: BookStrings = {
  chapter: 'Kapitel', part: 'Teil', contents: 'Inhalt', notes: 'Anmerkungen', index: 'Register', alsoBy: 'Weitere Bücher von',
  formatNames: { paperback: 'Taschenbuch', hardcover: 'gebundene Ausgabe', ebook: 'E-Book', largePrint: 'Großdruck' },
  kinds: kinds({
    toc: 'Inhalt', foreword: 'Geleitwort', preface: 'Vorwort', introduction: 'Einleitung', prologue: 'Prolog', epilogue: 'Epilog',
    afterword: 'Nachwort', acknowledgements: 'Danksagung', 'about-author': 'Über den Autor', 'also-by': 'Weitere Bücher des Autors',
    'note-to-readers': 'An die Leser', 'reading-group': 'Fragen für Lesekreise', endnotes: 'Anmerkungen', bibliography: 'Literaturverzeichnis',
    index: 'Register', appendix: 'Anhang', glossary: 'Glossar', dedication: 'Widmung', epigraph: 'Motto',
  }),
  copyrightWord: 'Copyright', publishedBy: 'Verlag:', firstPublished: 'Erstausgabe',
  nlaLine: 'Ein Katalogeintrag für dieses Buch ist bei der National Library of Australia erhältlich.',
  moralRight: 'Das Urheberpersönlichkeitsrecht des Autors wird geltend gemacht.', typesetIn: 'Gesetzt aus der', edition: 'Auflage',
  rights: 'Alle Rechte vorbehalten. Kein Teil dieser Veröffentlichung darf ohne vorherige schriftliche Genehmigung des Verlags vervielfältigt, in einem Datenabrufsystem gespeichert oder in irgendeiner Form oder auf irgendeine Weise, elektronisch, mechanisch, durch Fotokopie, Aufzeichnung oder anderweitig, übertragen werden, mit Ausnahme kurzer Zitate in Rezensionen.',
  firstEdition: 'Erstausgabe',
};

const IT: BookStrings = {
  chapter: 'Capitolo', part: 'Parte', contents: 'Indice', notes: 'Note', index: 'Indice analitico', alsoBy: 'Altri libri di',
  formatNames: { paperback: 'brossura', hardcover: 'copertina rigida', ebook: 'ebook', largePrint: 'caratteri grandi' },
  kinds: kinds({
    toc: 'Indice', foreword: 'Prefazione', preface: 'Premessa', introduction: 'Introduzione', prologue: 'Prologo', epilogue: 'Epilogo',
    afterword: 'Postfazione', acknowledgements: 'Ringraziamenti', 'about-author': 'L\u2019autore', 'also-by': 'Dello stesso autore',
    'note-to-readers': 'Nota per i lettori', 'reading-group': 'Domande per i gruppi di lettura', endnotes: 'Note', bibliography: 'Bibliografia',
    index: 'Indice analitico', appendix: 'Appendice', glossary: 'Glossario', dedication: 'Dedica', epigraph: 'Epigrafe',
  }),
  copyrightWord: 'Copyright', publishedBy: 'Pubblicato da', firstPublished: 'Prima edizione',
  nlaLine: 'Una scheda di catalogo di questo libro è disponibile presso la National Library of Australia.',
  moralRight: 'L\u2019autore rivendica il diritto morale sull\u2019opera.', typesetIn: 'Composto in', edition: 'edizione',
  rights: 'Tutti i diritti riservati. Nessuna parte di questa pubblicazione può essere riprodotta, archiviata in un sistema di recupero o trasmessa in qualsiasi forma o con qualsiasi mezzo, elettronico, meccanico, fotocopia, registrazione o altro, senza il previo consenso scritto dell\u2019editore, salvo brevi citazioni nelle recensioni.',
  firstEdition: 'Prima edizione',
};

const PT: BookStrings = {
  chapter: 'Capítulo', part: 'Parte', contents: 'Sumário', notes: 'Notas', index: 'Índice remissivo', alsoBy: 'Outros livros de',
  formatNames: { paperback: 'brochura', hardcover: 'capa dura', ebook: 'e-book', largePrint: 'letra grande' },
  kinds: kinds({
    toc: 'Sumário', foreword: 'Apresentação', preface: 'Prefácio', introduction: 'Introdução', prologue: 'Prólogo', epilogue: 'Epílogo',
    afterword: 'Posfácio', acknowledgements: 'Agradecimentos', 'about-author': 'Sobre o autor', 'also-by': 'Do mesmo autor',
    'note-to-readers': 'Nota aos leitores', 'reading-group': 'Questões para clubes de leitura', endnotes: 'Notas', bibliography: 'Bibliografia',
    index: 'Índice remissivo', appendix: 'Apêndice', glossary: 'Glossário', dedication: 'Dedicatória', epigraph: 'Epígrafe',
  }),
  copyrightWord: 'Copyright', publishedBy: 'Publicado por', firstPublished: 'Primeira edição',
  nlaLine: 'O registro de catálogo deste livro está disponível na Biblioteca Nacional da Austrália.',
  moralRight: 'O direito moral do autor foi assegurado.', typesetIn: 'Composto em', edition: 'edição',
  rights: 'Todos os direitos reservados. Nenhuma parte desta publicação pode ser reproduzida, armazenada em sistema de recuperação ou transmitida de qualquer forma ou por qualquer meio, eletrônico, mecânico, fotocópia, gravação ou outro, sem a autorização prévia por escrito do editor, exceto breves citações em resenhas.',
  firstEdition: 'Primeira edição',
};

const NL: BookStrings = {
  chapter: 'Hoofdstuk', part: 'Deel', contents: 'Inhoud', notes: 'Noten', index: 'Register', alsoBy: 'Ook van',
  formatNames: { paperback: 'paperback', hardcover: 'gebonden', ebook: 'e-book', largePrint: 'grote letter' },
  kinds: kinds({
    toc: 'Inhoud', foreword: 'Voorwoord', preface: 'Woord vooraf', introduction: 'Inleiding', prologue: 'Proloog', epilogue: 'Epiloog',
    afterword: 'Nawoord', acknowledgements: 'Dankwoord', 'about-author': 'Over de auteur', 'also-by': 'Ook van deze auteur',
    'note-to-readers': 'Aan de lezer', 'reading-group': 'Vragen voor leesclubs', endnotes: 'Noten', bibliography: 'Bibliografie',
    index: 'Register', appendix: 'Bijlage', glossary: 'Woordenlijst', dedication: 'Opdracht', epigraph: 'Motto',
  }),
  copyrightWord: 'Copyright', publishedBy: 'Uitgegeven door', firstPublished: 'Eerste uitgave',
  nlaLine: 'Een catalogusbeschrijving van dit boek is verkrijgbaar bij de National Library of Australia.',
  moralRight: 'Het morele recht van de auteur wordt voorbehouden.', typesetIn: 'Gezet in de', edition: 'druk',
  rights: 'Alle rechten voorbehouden. Niets uit deze uitgave mag worden verveelvoudigd, opgeslagen in een geautomatiseerd gegevensbestand of openbaar gemaakt, in enige vorm of op enige wijze, elektronisch, mechanisch, door fotokopieën, opnamen of op enige andere manier, zonder voorafgaande schriftelijke toestemming van de uitgever, behalve voor korte citaten in recensies.',
  firstEdition: 'Eerste druk',
};

const RU: BookStrings = {
  chapter: 'Глава', part: 'Часть', contents: 'Содержание', notes: 'Примечания', index: 'Указатель', alsoBy: 'Другие книги автора:',
  formatNames: { paperback: 'мягкая обложка', hardcover: 'твёрдый переплёт', ebook: 'электронная книга', largePrint: 'крупный шрифт' },
  kinds: kinds({
    toc: 'Содержание', foreword: 'Предисловие', preface: 'От автора', introduction: 'Введение', prologue: 'Пролог', epilogue: 'Эпилог',
    afterword: 'Послесловие', acknowledgements: 'Благодарности', 'about-author': 'Об авторе', 'also-by': 'Другие книги автора',
    'note-to-readers': 'К читателю', 'reading-group': 'Вопросы для читательского клуба', endnotes: 'Примечания', bibliography: 'Библиография',
    index: 'Указатель', appendix: 'Приложение', glossary: 'Глоссарий', dedication: 'Посвящение', epigraph: 'Эпиграф',
  }),
  copyrightWord: 'Copyright', publishedBy: 'Издатель:', firstPublished: 'Впервые опубликовано',
  nlaLine: 'Каталожная запись этой книги доступна в Национальной библиотеке Австралии.',
  moralRight: 'Личные неимущественные права автора защищены.', typesetIn: 'Набрано шрифтом', edition: 'издание',
  rights: 'Все права защищены. Никакая часть этого издания не может быть воспроизведена, сохранена в поисковой системе или передана в любой форме и любыми средствами, электронными, механическими, путём фотокопирования, записи или иными, без предварительного письменного разрешения издателя, за исключением кратких цитат в рецензиях.',
  firstEdition: 'Первое издание',
};

const AR: BookStrings = {
  chapter: 'الفصل', part: 'الجزء', contents: 'المحتويات', notes: 'الحواشي', index: 'الكشاف', alsoBy: 'من أعمال',
  formatNames: { paperback: 'غلاف ورقي', hardcover: 'غلاف مقوّى', ebook: 'كتاب إلكتروني', largePrint: 'طبعة بحروف كبيرة' },
  kinds: kinds({
    toc: 'المحتويات', foreword: 'تقديم', preface: 'مقدمة المؤلف', introduction: 'مقدمة', prologue: 'استهلال', epilogue: 'خاتمة',
    afterword: 'كلمة ختامية', acknowledgements: 'شكر وتقدير', 'about-author': 'عن المؤلف', 'also-by': 'من أعمال المؤلف',
    'note-to-readers': 'إلى القارئ', 'reading-group': 'أسئلة للنقاش في نوادي القراءة', endnotes: 'الحواشي', bibliography: 'المراجع',
    index: 'الكشاف', appendix: 'ملحق', glossary: 'مسرد المصطلحات', dedication: 'إهداء', epigraph: 'تصدير',
  }),
  copyrightWord: 'حقوق النشر', publishedBy: 'الناشر:', firstPublished: 'الطبعة الأولى',
  nlaLine: 'يتوفر سجل فهرسة لهذا الكتاب لدى المكتبة الوطنية الأسترالية.',
  moralRight: 'يحتفظ المؤلف بحقوقه المعنوية.', typesetIn: 'صُفّ بخط', edition: 'الطبعة',
  rights: 'جميع الحقوق محفوظة. لا يجوز نسخ أي جزء من هذا الكتاب أو تخزينه في نظام استرجاع أو نقله بأي شكل أو بأي وسيلة، إلكترونية كانت أو آلية أو بالتصوير أو التسجيل أو غير ذلك، دون إذن خطي مسبق من الناشر، باستثناء اقتباسات قصيرة في المراجعات.',
  firstEdition: 'الطبعة الأولى',
};

const HI: BookStrings = {
  chapter: 'अध्याय', part: 'भाग', contents: 'विषय सूची', notes: 'टिप्पणियाँ', index: 'अनुक्रमणिका', alsoBy: '{name} की अन्य पुस्तकें',
  formatNames: { paperback: 'पेपरबैक', hardcover: 'हार्डकवर', ebook: 'ई-बुक', largePrint: 'बड़े अक्षर' },
  kinds: kinds({
    toc: 'विषय सूची', foreword: 'प्राक्कथन', preface: 'प्रस्तावना', introduction: 'भूमिका', prologue: 'पूर्वकथा', epilogue: 'उपसंहार',
    afterword: 'पश्चलेख', acknowledgements: 'आभार', 'about-author': 'लेखक परिचय', 'also-by': 'लेखक की अन्य पुस्तकें',
    'note-to-readers': 'पाठकों से', 'reading-group': 'पाठक मंडली के लिए प्रश्न', endnotes: 'टिप्पणियाँ', bibliography: 'संदर्भ सूची',
    index: 'अनुक्रमणिका', appendix: 'परिशिष्ट', glossary: 'शब्दावली', dedication: 'समर्पण', epigraph: 'आमुख',
  }),
  copyrightWord: 'कॉपीराइट', publishedBy: 'प्रकाशक:', firstPublished: 'प्रथम संस्करण',
  nlaLine: 'A catalogue record for this book is available from the National Library of Australia.',
  moralRight: '', typesetIn: '', edition: 'संस्करण',
  rights: 'सर्वाधिकार सुरक्षित। प्रकाशक की पूर्व लिखित अनुमति के बिना इस प्रकाशन के किसी भी अंश को किसी भी रूप में या किसी भी माध्यम से, इलेक्ट्रॉनिक, यांत्रिक, फोटोकॉपी, रिकॉर्डिंग या अन्य प्रकार से, पुनरुत्पादित, संग्रहीत या प्रसारित नहीं किया जा सकता, समीक्षाओं में संक्षिप्त उद्धरणों को छोड़कर।',
  firstEdition: 'प्रथम संस्करण',
};

const TABLES: Record<string, BookStrings> = { en: EN, bn: BN, fr: FR, es: ES, de: DE, it: IT, pt: PT, nl: NL, ru: RU, ar: AR, hi: HI };

/** Languages whose printed words (Chapter, Contents, the copyright page) the app knows. Others print in English. */
export const TRANSLATED_LANGUAGES = Object.keys(TABLES);

export function stringsFor(language: string): BookStrings {
  return TABLES[baseLanguage(language)] ?? EN;
}

/** The title of an "Also by" page. */
export function alsoByTitle(s: BookStrings, name: string): string {
  return s.alsoBy.includes('{name}') ? s.alsoBy.replace('{name}', name) : `${s.alsoBy} ${name}`;
}

export function usesBengaliDigits(language: string): boolean {
  return digitSetFor(language) === 'bengali';
}

/** Write a number in the digits of the book's language and the author's choice. */
export function bookDigits(n: number | string, language: string, choice: 'auto' | 'latin' | 'native' = 'auto'): string {
  return toDigits(n, digitSetFor(language, choice));
}

const FR_ONES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const FR_TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
function frenchWords(n: number): string {
  if (n < 20) return FR_ONES[n];
  if (n < 70) {
    const t = FR_TENS[Math.floor(n / 10)];
    const o = n % 10;
    return o === 0 ? t : o === 1 ? `${t} et un` : `${t}-${FR_ONES[o]}`;
  }
  if (n < 80) return n === 71 ? 'soixante et onze' : `soixante-${FR_ONES[n - 60]}`;
  if (n < 100) return n === 80 ? 'quatre-vingts' : `quatre-vingt-${FR_ONES[n - 80]}`;
  if (n === 100) return 'cent';
  if (n < 200) return `cent ${frenchWords(n - 100)}`;
  return String(n);
}

const ES_ONES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const ES_TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
function spanishWords(n: number): string {
  if (n < 30) return ES_ONES[n];
  if (n < 100) return n % 10 ? `${ES_TENS[Math.floor(n / 10)]} y ${ES_ONES[n % 10]}` : ES_TENS[n / 10];
  if (n === 100) return 'cien';
  if (n < 200) return `ciento ${spanishWords(n - 100)}`;
  return String(n);
}

const DE_ONES = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const DE_TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
function germanWords(n: number): string {
  if (n < 20) return DE_ONES[n];
  if (n < 100) {
    const o = n % 10;
    const t = DE_TENS[Math.floor(n / 10)];
    return o === 0 ? t : `${o === 1 ? 'ein' : DE_ONES[o]}und${t}`;
  }
  if (n === 100) return 'hundert';
  if (n < 200) return `hundert${germanWords(n - 100)}`;
  return String(n);
}

const upperFirst = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * A number spelled out for a chapter label ("Chapter Twelve", "Chapitre douze"),
 * or null in languages where the app does not spell numbers.
 */
export function numberWordsFor(n: number, language: string): string | null {
  switch (baseLanguage(language)) {
    case 'en': return titleCase(numberToWords(n));
    case 'fr': return n < 200 ? upperFirst(frenchWords(n)) : null;
    case 'es': return n < 200 ? upperFirst(spanishWords(n)) : null;
    case 'de': return n < 200 ? upperFirst(germanWords(n)) : null;
    default: return null;
  }
}

/** Roman numerals are a Latin script convention; other scripts keep their digits. */
const usesRoman = (digits: DigitSet, language: string): boolean => digits === 'latin' && !['ar', 'fa', 'ur', 'he', 'zh', 'ja', 'ko', 'hi', 'mr', 'ne', 'bn'].includes(baseLanguage(language));

export type NumberStyle =
  | 'none' | 'arabic' | 'roman' | 'words' | 'chapter-arabic' | 'chapter-words' | 'chapter-roman';

/**
 * The label printed above a chapter title: "Chapter One", "1", "IV" and so on.
 * Numbers are written in the digits of the book's language; number words are
 * spelled out in English, French, Spanish and German and given as digits elsewhere.
 */
export function chapterLabel(n: number, style: NumberStyle, language: string, word?: string, digitChoice: 'auto' | 'latin' | 'native' = 'auto'): string {
  if (style === 'none') return '';
  const s = stringsFor(language);
  const set = digitSetFor(language, digitChoice);
  const digits = toDigits(n, set);
  const roman = usesRoman(set, language) ? toRoman(n, true) : digits;
  const words = numberWordsFor(n, language) ?? digits;
  const chapterWord = word ?? s.chapter;
  switch (style) {
    case 'arabic':
      return digits;
    case 'roman':
      return roman;
    case 'words':
      return words;
    case 'chapter-arabic':
      return `${chapterWord} ${digits}`;
    case 'chapter-roman':
      return `${chapterWord} ${roman}`;
    case 'chapter-words':
      return `${chapterWord} ${words}`;
  }
}

export function partLabel(n: number, style: 'none' | 'roman' | 'words' | 'arabic', language: string, digitChoice: 'auto' | 'latin' | 'native' = 'auto'): string {
  if (style === 'none') return '';
  return chapterLabel(n, style === 'roman' ? 'chapter-roman' : style === 'words' ? 'chapter-words' : 'chapter-arabic', language, stringsFor(language).part, digitChoice);
}
