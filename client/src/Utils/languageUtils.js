/**
 * Language configuration for the application
 * Note: Language is now automatically detected, no manual selection needed
 */
export const LANGUAGES = {
    ENGLISH: { code: 'en', name: 'English' },
    TAMIL: { code: 'ta', name: 'தமிழ் (Tamil)' },
    MALAYALAM: { code: 'ml', name: 'മലയാളം (Malayalam)' }
};

/**
 * Detect language using Unicode patterns
 * @param {string} text - Text to detect language from
 * @returns {{detectedLang: string, detectedLangName: string}}
 */
const detectLanguageFromUnicode = (text) => {
    // Check Unicode ranges for specific languages
    if (/[\u0D00-\u0D7F]/.test(text)) { // Malayalam
        return { detectedLang: 'ml', detectedLangName: 'Malayalam (മലയാളം)' };
    } else if (/[\u0B80-\u0BFF]/.test(text)) { // Tamil
        return { detectedLang: 'ta', detectedLangName: 'Tamil (தமிழ்)' };
    } else if (/[\u0900-\u097F]/.test(text)) { // Hindi/Devanagari
        return { detectedLang: 'hi', detectedLangName: 'Hindi (हिन्दी)' };
    } else if (/[\u0C00-\u0C7F]/.test(text)) { // Telugu
        return { detectedLang: 'te', detectedLangName: 'Telugu (తెలుగు)' };
    } else if (/[\u0C80-\u0CFF]/.test(text)) { // Kannada
        return { detectedLang: 'kn', detectedLangName: 'Kannada (ಕನ್ನಡ)' };
    } else if (/[\u0A80-\u0AFF]/.test(text)) { // Gujarati
        return { detectedLang: 'gu', detectedLangName: 'Gujarati (ગુજરાતી)' };
    } else if (/[\u0980-\u09FF]/.test(text)) { // Bengali
        return { detectedLang: 'bn', detectedLangName: 'Bengali (বাংলা)' };
    } else if (/[\u0A00-\u0A7F]/.test(text)) { // Punjabi
        return { detectedLang: 'pa', detectedLangName: 'Punjabi (ਪੰਜਾਬੀ)' };
    } else if (/[\u0600-\u06FF]/.test(text)) { // Arabic
        return { detectedLang: 'ar', detectedLangName: 'Arabic (العربية)' };
    } else if (/[\u4E00-\u9FFF]/.test(text)) { // Chinese
        return { detectedLang: 'zh', detectedLangName: 'Chinese (中文)' };
    } else if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) { // Japanese (Hiragana/Katakana)
        return { detectedLang: 'ja', detectedLangName: 'Japanese (日本語)' };
    } else if (/[\uAC00-\uD7AF]/.test(text)) { // Korean
        return { detectedLang: 'ko', detectedLangName: 'Korean (한국어)' };
    } else if (/[\u0400-\u04FF]/.test(text)) { // Cyrillic (Russian, etc.)
        return { detectedLang: 'ru', detectedLangName: 'Russian (Русский)' };
    } else if (/^[a-zA-Z\s.,!?'"]+$/.test(text.trim())) { // Only Latin characters
        return { detectedLang: 'en', detectedLangName: 'English' };
    } else {
        return { detectedLang: 'unknown', detectedLangName: 'Unknown Language' };
    }
};

/**
 * Detect language and translate to English automatically using MyMemory API
 * @param {string} text - Text to detect and translate
 * @returns {Promise<{translatedText: string, detectedLang: string, detectedLangName: string}>}
 */
export const detectAndTranslate = async (text) => {
    if (!text || text.trim() === '') {
        return {
            translatedText: text,
            detectedLang: 'en',
            detectedLangName: 'English'
        };
    }

    // First, detect language using Unicode patterns
    const unicodeDetection = detectLanguageFromUnicode(text);

    try {
        // Use MyMemory Translation API (browser-compatible, no CORS issues)
        // Auto-detect source language by not specifying langpair source
        const encodedText = encodeURIComponent(text);
        const url = `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=autodetect|en`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.responseStatus === 200 && data.responseData) {
            const translatedText = data.responseData.translatedText;

            let detectedLang = unicodeDetection.detectedLang;
            let detectedLangName = unicodeDetection.detectedLangName;

            // If translation is same as original, it's probably already English
            if (text.toLowerCase().trim() === translatedText.toLowerCase().trim()) {
                detectedLang = 'en';
                detectedLangName = 'English';
            } else if (data.responseData.detectedLanguage) {
                // Use MyMemory's detected language if available and not 'en'
                // MyMemory's detectedLanguage is often more accurate for non-English
                if (data.responseData.detectedLanguage !== 'en') {
                    detectedLang = data.responseData.detectedLanguage;
                    // Attempt to map to a more readable name if possible, otherwise use 'Auto-detected'
                    const languageNamesMap = {
                        'en': 'English', 'ta': 'Tamil (தமிழ்)', 'ml': 'Malayalam (മലയാളം)',
                        'hi': 'Hindi (हिन्दी)', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
                        'ja': 'Japanese (日本語)', 'zh': 'Chinese (中文)', 'ar': 'Arabic (العربية)',
                        'pt': 'Portuguese', 'ru': 'Russian (Русский)', 'it': 'Italian',
                        'ko': 'Korean (한국어)', 'te': 'Telugu (తెలుగు)', 'kn': 'Kannada (ಕನ್ನಡ)',
                        'bn': 'Bengali (বাংলা)', 'mr': 'Marathi', 'gu': 'Gujarati (ગુજરાતી)',
                        'pa': 'Punjabi (ਪੰਜਾਬੀ)', 'ur': 'Urdu'
                    };
                    detectedLangName = languageNamesMap[detectedLang] || 'Auto-detected';
                }
            } else if (detectedLang === 'unknown') {
                // If Unicode detection failed and MyMemory didn't provide, fallback to 'Auto-detected'
                detectedLangName = 'Auto-detected';
            }

            // Return with Unicode-based language detection
            return {
                translatedText: translatedText,
                detectedLang: unicodeDetection.detectedLang,
                detectedLangName: unicodeDetection.detectedLangName
            };
        } else {
            throw new Error('Translation API returned an error');
        }
    } catch (error) {
        console.error('Auto-detection/translation error:', error);
        // If auto-detection fails, return original text as fallback
        return {
            translatedText: text,
            detectedLang: 'unknown',
            detectedLangName: 'Unknown',
            error: error.message
        };
    }
};

/**
 * Translate text from source language to English using MyMemory API
 * @param {string} text - Text to translate
 * @param {string} sourceLang - Source language code (e.g., 'ta', 'ml')
 * @returns {Promise<string>} - Translated text in English
 */
export const translateToEnglish = async (text, sourceLang) => {
    // If source is already English, return as is
    if (sourceLang === 'en') {
        return text;
    }

    try {
        const encodedText = encodeURIComponent(text);
        const url = `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=${sourceLang}|en`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.responseStatus === 200 && data.responseData) {
            return data.responseData.translatedText;
        } else {
            throw new Error('Translation failed');
        }
    } catch (error) {
        console.error('Translation error:', error);
        // If translation fails, return original text
        // This allows fallback to fingerspelling
        return text;
    }
};

/**
 * Get speech recognition language code for the selected language
 * @param {string} langCode - Language code
 * @returns {string} - Browser speech recognition language code
 */
export const getSpeechRecognitionLang = (langCode) => {
    const speechLangMap = {
        'en': 'en-US',
        'ta': 'ta-IN',
        'ml': 'ml-IN'
    };
    return speechLangMap[langCode] || 'en-US';
};

/**
 * Get placeholder text for input based on language
 * @param {string} langCode - Language code
 * @returns {string} - Placeholder text
 */
export const getPlaceholderText = (langCode) => {
    const placeholders = {
        'en': 'Text input ...',
        'ta': 'உரை உள்ளீடு ...',
        'ml': 'ടെക്സ്റ്റ് ഇൻപുട്ട് ...'
    };
    return placeholders[langCode] || 'Text input ...';
};

/**
 * Get speech placeholder text based on language
 * @param {string} langCode - Language code
 * @returns {string} - Speech placeholder text
 */
export const getSpeechPlaceholderText = (langCode) => {
    const placeholders = {
        'en': 'Speech input ...',
        'ta': 'பேச்சு உள்ளீடு ...',
        'ml': 'സംസാര ഇൻപുട്ട് ...'
    };
    return placeholders[langCode] || 'Speech input ...';
};
