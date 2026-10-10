# Scalers legal pack

> **DRAFT for legal review.** Not yet in force. Last updated: 9 October 2026.

## In short
These are plain-English first drafts of Scalers's legal documents. They are **not in force** and must be reviewed by a Kenyan advocate before use. They describe the Service as it actually works today (October 2026, Private Beta). Fill in every `[placeholder]` before publishing. No public web pages exist for these yet; adding `/terms` and `/privacy` routes is a later step.

## The documents
| Document | What it is | Who it's for |
| --- | --- | --- |
| [DEFINITIONS.md](DEFINITIONS.md) | Shared words used across all documents | Everyone |
| [TERMS_OF_SERVICE.md](TERMS_OF_SERVICE.md) | The main contract: what we provide, payment, liability, ending | Businesses |
| [PRIVACY_POLICY.md](PRIVACY_POLICY.md) | What personal data we collect, why, and people's rights | Callers, Owners, Users, ODPC |
| [DATA_PROCESSING_AGREEMENT.md](DATA_PROCESSING_AGREEMENT.md) | Business = controller, Scalers = processor; subprocessors | Businesses |
| [CALL_RECORDING_AND_AI_NOTICE.md](CALL_RECORDING_AND_AI_NOTICE.md) | Spoken greeting line (EN/SW) and written notice | Callers; Voice/Brain team |
| [ACCEPTABLE_USE_AND_BETA.md](ACCEPTABLE_USE_AND_BETA.md) | Rules of use, AI limits, Private Beta terms | Businesses |

## Placeholders to fill
- [Registered company name], [P.O. Box / physical address]
- [ODPC registration no.], [Data Protection Officer name, if appointed]
- [contact email, e.g. legal@scalers.co.ke], [privacy@scalers.co.ke]
- [pricing link or schedule], [VAT position], [KES amount] liability floor
- Notice periods ([14] days), export window ([30] days), breach notice to Business ([24–48] hours), rights reply time
- Call recording retention period
- Subprocessor locations and regions
- Restricted business categories; beta minute-cap rule; spoken notice language choice

## Lawyer-review checklist
- [ ] ODPC: must Scalers register as processor and/or controller? Which fee band? Must each Business register?
- [ ] Is the controller/processor split right, given Scalers sets the AI and retention defaults?
- [ ] Cross-border transfers (Data Protection (General) Regulations, 2021): what safeguard and proof are needed for each subprocessor abroad?
- [ ] Is "may be recorded" plus AI disclosure at greeting enough consent for recording? Is any other legal basis or opt-out needed?
- [ ] Should the notice play in both English and Swahili?
- [ ] Is a Data Protection Impact Assessment required (AI processing, recordings at scale)?
- [ ] Recording retention period: what is defensible?
- [ ] Liability cap and "as is" wording: enforceable against SMEs under the Consumer Protection Act, 2012?
- [ ] Breach timelines: processor-to-controller window and the 72-hour ODPC notice.
- [ ] VAT, eTIMS and invoicing wording for Packages.
- [ ] Computer Misuse and Cybercrimes Act: any duties for us as a platform?
- [ ] How Businesses accept these terms (click-through at signup vs signed contract).
- [ ] Dispute route: Nairobi courts only, or mediation/arbitration first?

## Engineering notes
- The greeting has **not** been changed. Voice/Brain must wire the spoken line in a separate PR.
- Keep these documents in line with the product. If a feature ships (M-Pesa, live transfer, charging), update the Terms and Privacy Policy before launch.
