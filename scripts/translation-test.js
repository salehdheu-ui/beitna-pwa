#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const { createTranslator } = require('../server/translate.js');

async function main() {
  const cache = {};
  const calls = [];
  const fakeFetch = async (input) => {
    const url = new URL(input);
    const q = url.searchParams.get('q');
    const pair = url.searchParams.get('langpair');
    calls.push({ q, pair });
    assert.ok(Buffer.byteLength(q, 'utf8') <= 500, 'تجاوز طلب الترجمة حد المزود');
    const target = pair.split('|')[1];
    return {
      ok: true,
      async json() {
        const translatedText = q.split('\n').map((line) => `${target}:${line}`).join('\n');
        return { responseStatus: 200, responseData: { translatedText } };
      },
    };
  };

  const translator = createTranslator({ cache, fetchFn: fakeFetch, apiUrl: 'https://translation.test/get' });
  const swahili = await translator.translateDocument('shopping', {
    name: 'maziwa', quantity: 'pakiti mbili', sourceLang: 'sw',
  }, 'ar');
  assert.equal(swahili.name, 'maziwa', 'تغيّر النص الأصلي');
  assert.equal(swahili.translations.ar.name, 'ar:maziwa');
  assert.equal(swahili.translations.en.quantity, 'en:pakiti mbili');
  assert.equal(calls.length, 4);

  await translator.translateDocument('shopping', {
    name: 'maziwa', quantity: 'pakiti mbili', sourceLang: 'sw',
  }, 'ar');
  assert.equal(calls.length, 4, 'لم تُستخدم ذاكرة الترجمة');

  const arabic = await translator.translateDocument('faults', {
    title: 'تسريب ماء', sourceLang: 'ar',
  }, 'ar');
  assert.equal(arabic.translations.ar.title, 'تسريب ماء');
  assert.equal(arabic.translations.en.title, 'en:تسريب ماء');

  const pantry = await translator.translateDocument('pantry', {
    name: 'mafuta', sourceLang: 'sw', stocked: true,
  }, 'sw');
  assert.equal(pantry.translations.ar.name, 'ar:mafuta');
  assert.equal(pantry.translations.en.name, 'en:mafuta');

  const bulk = await translator.translateTexts(['حليب', 'تونة', 'سكر'], 'ar', 'sw');
  assert.deepEqual(bulk, ['sw:حليب', 'sw:تونة', 'sw:سكر']);
  assert.equal(calls.filter((x) => x.pair === 'ar|sw').length, 1, 'لم تُجمع أسماء المنتجات في طلب واحد');

  const unavailable = createTranslator({
    cache: {}, apiUrl: 'https://translation.test/get',
    fetchFn: async () => ({ ok: false, status: 503 }),
  });
  const fallback = await unavailable.translateDocument('shopping', {
    name: 'दूध', sourceLang: 'hi',
  }, 'hi');
  assert.equal(fallback.name, 'दूध');
  assert.equal(fallback.translations.ar.name, undefined);
  assert.equal(fallback.translations.en.name, undefined);

  const long = 'maziwa '.repeat(150);
  const chunked = await translator.translateText(long, 'sw', 'en');
  assert.ok(chunked.includes('en:maziwa'));
  assert.ok(calls.filter((x) => x.q.includes('maziwa')).length > 4, 'النص الطويل لم يُقسّم');

  console.log('  [ok] الترجمة، الذاكرة المحلية، التقسيم، والرجوع إلى الأصل اجتازت الاختبار');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
