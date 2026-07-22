import re
import requests
from typing import Dict, Any, Optional

LANGUAGES = {
    'ENGLISH': {'code': 'en', 'name': 'English'},
    'TAMIL': {'code': 'ta', 'name': 'தமிழ் (Tamil)'},
    'MALAYALAM': {'code': 'ml', 'name': 'മലയാളം (Malayalam)'}
}

def detect_language_from_unicode(text: str) -> Dict[str, str]:
    """Detect language using Unicode patterns."""
    if re.search(r'[\u0D00-\u0D7F]', text):  # Malayalam
        return {'detectedLang': 'ml', 'detectedLangName': 'Malayalam (മലയാളം)'}
    elif re.search(r'[\u0B80-\u0BFF]', text):  # Tamil
        return {'detectedLang': 'ta', 'detectedLangName': 'Tamil (தமிழ்)'}
    elif re.search(r'[\u0900-\u097F]', text):  # Devanagari
        return {'detectedLang': 'hi', 'detectedLangName': 'Hindi (हिन्दी)'}
    elif re.match(r'^[a-zA-Z\s.,!?\'"]+$', text.strip()):
        return {'detectedLang': 'en', 'detectedLangName': 'English'}
    else:
        return {'detectedLang': 'unknown', 'detectedLangName': 'Unknown Language'}

def detect_and_translate(text: str) -> Dict[str, Any]:
    """Detect language and translate to English using MyMemory API."""
    if not text or not text.strip():
        return {
            'translated_text': text,
            'detectedLang': 'en',
            'detectedLangName': 'English'
        }

    unicode_detection = detect_language_from_unicode(text)
    
    # If already English, skip API call to save time and prevent mangling
    if unicode_detection['detectedLang'] == 'en':
        return {
            'translated_text': text,
            'detectedLang': 'en',
            'detectedLangName': 'English'
        }
    
    try:
        url = f"https://api.mymemory.translated.net/get?q={requests.utils.quote(text)}&langpair=autodetect|en"
        response = requests.get(url)
        data = response.json()

        if response.status_code == 200 and 'responseData' in data:
            translated_text = data['responseData']['translatedText']
            detected_lang = unicode_detection['detectedLang']
            detected_lang_name = unicode_detection['detectedLangName']

            if text.lower().strip() == translated_text.lower().strip():
                detected_lang = 'en'
                detected_lang_name = 'English'
            
            return {
                'translated_text': translated_text,
                'detectedLang': detected_lang,
                'detectedLangName': detected_lang_name
            }
        else:
            raise Exception("Translation API error")
            
    except Exception as e:
        print(f"Translation error: {e}")
        return {
            'translated_text': text,
            'detectedLang': unicode_detection['detectedLang'],
            'detectedLangName': unicode_detection['detectedLangName'],
            'error': str(e)
        }
