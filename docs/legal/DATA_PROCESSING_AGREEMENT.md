# Data Processing Agreement (DPA)

> **DRAFT for legal review.** Not yet in force. Last updated: 9 October 2026.

## In short
Each Business owns the data about its Callers. Scalers only handles that data to run the Service for the Business, following its instructions and Kenya's Data Protection Act, 2019. We keep it secure and confidential, use only the listed providers, help the Business answer people's requests, tell the Business quickly about any breach, and delete or return the data when the Service ends. This DPA is part of the [Terms of Service](TERMS_OF_SERVICE.md).

Words in **bold** are defined in [DEFINITIONS.md](DEFINITIONS.md).

## 1. Roles
- The **Business** is the **data controller** of Caller Data. It decides why the data is used.
- **Scalers** is the **data processor**. It uses Caller Data only for the Business.

## 2. What is processed
- **People:** Callers, and people named on calls.
- **Data:** phone number, name, call audio and recordings, transcripts, requests and bookings, call traces.
- **Purpose:** answering calls, taking requests, notifying the Owner, showing data in the Desk, and keeping the Service working and safe.
- **Length:** while the Service runs, plus the deletion period in section 9.

## 3. The Business's duties
- Have a lawful basis to collect Caller Data.
- Tell Callers about AI answering and recording (see the [Call Recording and AI Notice](CALL_RECORDING_AND_AI_NOTICE.md)).
- Register with the ODPC if the law requires it.
- Give only lawful instructions.

## 4. Scalers's duties
- Process Caller Data only on the Business's documented instructions (these Terms and its Desk settings), unless the law requires otherwise, in which case we tell the Business if we lawfully can.
- Make sure our staff and contractors keep it confidential.
- Keep reasonable security: access controls, encryption in transit, separating each Business's data, and logs.
- Not sell Caller Data or use it for our own marketing.

## 5. Subprocessors
The Business agrees that we may use these providers. We will tell the Business at least [14] days before adding or replacing one, and the Business may object.

<a id="subprocessors"></a>
| Subprocessor | What it does | Data it handles | Location |
| --- | --- | --- | --- |
| SautiKit | Phone numbers, call routing, call recordings, WhatsApp messages | Phone numbers, call audio, recordings, WhatsApp messages | [confirm] |
| Soniox | Speech-to-text and text-to-speech during calls | Call audio and text | [confirm, likely USA] |
| Google (Gemini) | AI that understands Callers and writes replies | Transcripts and Business Data | [confirm region] |
| Supabase | Database, file storage and login | All Service data | [confirm region] |
| Railway | Runs the voice server | Call data in transit and in memory | [confirm region] |
| Vercel | Hosts the Desk web app | Desk data in transit | [confirm region] |
| TextSMS | Sends SMS notifications to Owners | Owner phone number, call summary | Kenya [confirm] |
| Resend | Sends email notifications | Owner email, call summary | [confirm, likely USA] |
| Meta (WhatsApp), via SautiKit | Delivers WhatsApp messages | Owner phone number, message content | [confirm] |

## 6. Transfers outside Kenya
Where a Subprocessor is outside Kenya, we rely on safeguards allowed by the Data Protection Act and its regulations (for example contracts with data protection terms) and keep proof of them. [Counsel to confirm transfer basis.]

## 7. Helping the Business
- **People's rights:** we pass on any request from a Caller to the Business and help it reply, for example by finding, correcting or deleting records.
- **Assessments:** we give reasonable help with data protection impact assessments and ODPC questions.

## 8. Breaches
If we learn of a breach affecting Caller Data, we tell the Business without undue delay, and within [24–48] hours, so it can notify the ODPC within 72 hours. We share what happened, what data is affected, and what we are doing about it.

## 9. Ending
When the Service ends, the Business can ask for an export within [30] days. After that we delete Caller Data, unless the law requires us to keep it. Call traces are always deleted after 30 days.

## 10. Checks
On reasonable notice, and no more than once a year unless there is a breach, we give the Business information to show we follow this DPA.

## 11. Order of documents
If this DPA conflicts with the Terms on personal data, this DPA wins.
