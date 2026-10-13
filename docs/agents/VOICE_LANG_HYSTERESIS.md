# VOICE_LANG_HYSTERESIS

Flagged language lock for mirroring and code-switching. Default **off**.

| Flag off | Flag on |
| --- | --- |
| `resolveLanguageState` / `resolveCallLanguage` unchanged | Turn scored by Soniox tags + content words; switch on **2 of last 3** content turns, or one clear turn (share ≥ 0.85, ≥ 6 words), or an explicit request that **pins** |
| Greeting TTS uses one language | Greeting split into sentences; each gets its own TTS `lang` |

## #614 consumer

```js
const { lockReplyLanguage } = require('../conversation/languageHysteresis');
// Same shape as src/speech/structured/languageLock.js:
// { lang: 'en'|'sw'|'sheng', source: string }
```

Do not edit #614 in this PR. Phase 2 can switch its import when both ship.
