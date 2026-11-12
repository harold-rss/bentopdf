const allTesseractLanguages: Record<string, string> = {
    "eng": "English", "afr": "Afrikaans", "amh": "Amharic", "ara": "Arabic", "asm": "Assamese", "aze": "Azerbaijani",
    "aze_cyrl": "Azerbaijani - Cyrillic", "bel": "Belarusian", "ben": "Bengali", "bod": "Tibetan", "bos": "Bosnian",
    "bul": "Bulgarian", "cat": "Catalan; Valencian", "ceb": "Cebuano", "ces": "Czech", "chi_sim": "Chinese - Simplified",
    "chi_tra": "Chinese - Traditional", "chr": "Cherokee", "cym": "Welsh", "dan": "Danish", "deu": "German",
    "dzo": "Dzongkha", "ell": "Greek, Modern (1453-)", "enm": "English, Middle (1100-1500)", "epo": "Esperanto",
    "est": "Estonian", "eus": "Basque", "fas": "Persian", "fin": "Finnish", "fra": "French", "frk": "German Fraktur",
    "frm": "French, Middle (ca. 1400-1600)", "gle": "Irish", "glg": "Galician", "grc": "Greek, Ancient (-1453)",
    "guj": "Gujarati", "hat": "Haitian; Haitian Creole", "heb": "Hebrew", "hin": "Hindi", "hrv": "Croatian",
    "hun": "Hungarian", "iku": "Inuktitut", "ind": "Indonesian", "isl": "Icelandic", "ita": "Italian",
    "ita_old": "Italian - Old", "jav": "Javanese", "jpn": "Japanese", "kan": "Kannada", "kat": "Georgian",
    "kat_old": "Georgian - Old", "kaz": "Kazakh", "khm": "Central Khmer", "kir": "Kirghiz; Kyrgyz",
    "kor": "Korean", "kur": "Kurdish", "lao": "Lao", "lat": "Latin", "lav": "Latvian", "lit": "Lithuanian",
    "mal": "Malayalam", "mar": "Marathi", "mkd": "Macedonian", "mlt": "Maltese", "msa": "Malay", "mya": "Burmese",
    "nep": "Nepali", "nld": "Dutch; Flemish", "nor": "Norwegian", "ori": "Oriya", "pan": "Panjabi; Punjabi",
    "pol": "Polish", "por": "Portuguese", "pus": "Pushto; Pashto", "ron": "Romanian; Moldavian; Moldovan",
    "rus": "Russian", "san": "Sanskrit", "sin": "Sinhala; Sinhalese", "slk": "Slovak", "slv": "Slovenian",
    "spa": "Spanish; Castilian", "spa_old": "Spanish; Castilian - Old", "sqi": "Albanian", "srp": "Serbian",
    "srp_latn": "Serbian - Latin", "swa": "Swahili", "swe": "Swedish", "syr": "Syriac", "tam": "Tamil", "tel": "Telugu",
    "tgk": "Tajik", "tgl": "Tagalog", "tha": "Thai", "tir": "Tigrinya", "tur": "Turkish", "uig": "Uighur; Uyghur",
    "ukr": "Ukrainian", "urd": "Urdu", "uzb": "Uzbek", "uzb_cyrl": "Uzbek - Cyrillic", "vie": "Vietnamese", "yid": "Yiddish"
};

// Language data is bundled with the app instead of being downloaded from a CDN,
// so only the languages installed as @tesseract.js-data/<code> packages are
// offered. The build injects that list; see vite.config.ts.
declare const __OCR_LANGS__: string[] | undefined;
const bundledLanguages: string[] =
    typeof __OCR_LANGS__ !== 'undefined' ? __OCR_LANGS__ : Object.keys(allTesseractLanguages);

export const tesseractLanguages: Record<string, string> = Object.fromEntries(
    Object.entries(allTesseractLanguages).filter(([code]) => bundledLanguages.includes(code))
);
