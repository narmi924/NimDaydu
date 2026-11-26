import { useEffect, useState } from 'react';
import { defaultUiLanguage, watchUiLanguage } from './ui-language';
import { messagesFor, type Message } from './ui-messages';

export function useUiLanguage(title: Message) {
  const [language, setLanguage] = useState(defaultUiLanguage);
  useEffect(() => watchUiLanguage(setLanguage), []);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `NimDaydu · ${messagesFor(language)(title)}`;
  }, [language, title]);
  return language;
}
