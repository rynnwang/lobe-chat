'use server';

import { get } from 'lodash-es';
import { cookies } from 'next/headers';

import { DEFAULT_LANG, LOBE_LOCALE_COOKIE } from '@/const/locale';
import { NS, normalizeLocale } from '@/locales/resources';
import { isDev } from '@/utils/env';

// Uses dynamic import (instead of node:fs) so the locale JSON is bundled into
// the build output, which is required for the Edge Runtime (no filesystem access).
export const translation = async (ns: NS = 'common') => {
  let i18ns = {};
  try {
    const cookieStore = cookies();
    const defaultLang = cookieStore.get(LOBE_LOCALE_COOKIE);
    const lng = defaultLang?.value || DEFAULT_LANG;

    try {
      i18ns = await import(`@/../locales/${normalizeLocale(lng)}/${ns}.json`);
    } catch {
      i18ns = await import(
        `@/../locales/${normalizeLocale(isDev ? 'zh-CN' : DEFAULT_LANG)}/${ns}.json`
      );
    }
  } catch (e) {
    console.error('Error while reading translation file', e);
  }

  return {
    t: (key: string, options: { [key: string]: string } = {}) => {
      if (!i18ns) return key;
      let content = get(i18ns, key);
      if (!content) return key;
      if (options) {
        Object.entries(options).forEach(([key, value]) => {
          content = content.replace(`{{${key}}}`, value);
        });
      }
      return content;
    },
  };
};
